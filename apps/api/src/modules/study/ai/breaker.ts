import { ProviderError, type EmbeddingProvider, type LLMProvider } from './provider.js';

/** Outages in a row (after the retry) before answers pause, and how long the pause lasts. */
export const BREAKER_THRESHOLD = 5;
export const BREAKER_OPEN_MS = 60_000;
/** The one retry waits this long, or what the provider asked for, up to the cap (a member is waiting). */
const RETRY_MS = 800;
const RETRY_CAP_MS = 4000;

/**
 * Stops calling a provider that keeps failing (spec §8), per college and endpoint, on this server:
 * after BREAKER_THRESHOLD outages in a row, calls fail at once for a minute, so members get the
 * passages straight away instead of waiting for timeouts. Then one call is let through; if it
 * fails too, the pause starts again. Only outages count (rate limits, 5xx, timeouts, network): a
 * rejected key or a refused request is not the provider being down.
 */
export class CircuitBreaker {
  private readonly state = new Map<string, { failures: number; openUntil: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** When the pause for `key` ends, or null when calls go through. */
  openUntil(key: string): number | null {
    const s = this.state.get(key);
    return s && s.openUntil > this.now() ? s.openUntil : null;
  }

  check(key: string) {
    if (this.openUntil(key) !== null)
      throw new ProviderError(
        'unavailable',
        'The provider failed several times in a row, so answers pause for a minute',
      );
  }

  success(key: string) {
    this.state.delete(key);
  }

  failure(key: string, e: unknown) {
    if (!(e instanceof ProviderError) || !e.retryable) return;
    const s = this.state.get(key) ?? { failures: 0, openUntil: 0 };
    s.failures++;
    if (s.failures >= BREAKER_THRESHOLD) {
      s.openUntil = this.now() + BREAKER_OPEN_MS;
      // Half-open afterwards: the next failure pauses again at once.
      s.failures = BREAKER_THRESHOLD - 1;
    }
    if (this.state.size > 5000) this.state.clear();
    this.state.set(key, s);
  }
}

export interface Guard {
  breaker: CircuitBreaker;
  key: string;
  sleep: (ms: number) => Promise<void>;
}

/**
 * An answer model behind the breaker, with one retry for an outage that happens before any text
 * reached the member (a retry after that would repeat what they already read).
 */
export function guardedChat(p: LLMProvider, g: Guard): LLMProvider {
  return {
    id: p.id,
    listModels: () => p.listModels(),
    async generate(req, opts = {}) {
      g.breaker.check(g.key);
      for (let attempt = 1; ; attempt++) {
        let streamed = false;
        const { onText } = opts;
        try {
          const r = await p.generate(req, {
            ...opts,
            ...(onText
              ? {
                  onText: (d: string) => {
                    streamed = true;
                    onText(d);
                  },
                }
              : {}),
          });
          g.breaker.success(g.key);
          return r;
        } catch (e) {
          // Stopped by the member: not the provider's fault.
          if (opts.signal?.aborted) throw e;
          if (!(e instanceof ProviderError) || !e.retryable || streamed || attempt >= 2) {
            g.breaker.failure(g.key, e);
            throw e;
          }
          await g.sleep(Math.min(e.retryAfterMs ?? RETRY_MS, RETRY_CAP_MS));
        }
      }
    },
  };
}

/** Embeddings behind the breaker (the indexing job retries on its own; searches fall back to keywords). */
export function guardedEmbeddings(p: EmbeddingProvider, g: Guard): EmbeddingProvider {
  return {
    id: p.id,
    listModels: () => p.listModels(),
    async embed(texts, model) {
      g.breaker.check(g.key);
      try {
        const r = await p.embed(texts, model);
        g.breaker.success(g.key);
        return r;
      } catch (e) {
        g.breaker.failure(g.key, e);
        throw e;
      }
    },
  };
}
