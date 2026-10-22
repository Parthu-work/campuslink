import type { AiProvider, EmbeddingProvider as EmbeddingProviderId } from '@campuslink/shared';
import { SafeFetchError, type SafeMethod, type safeFetch } from '../../../lib/safe-fetch.js';

/**
 * The language-model and embedding adapters. Every provider is one file implementing these
 * interfaces; every call goes through the SSRF-safe fetcher; keys never appear in errors or logs.
 */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}
export interface GenerateRequest {
  model: string;
  system: string;
  messages: ChatTurn[];
  /** Visible answer length cap. */
  maxTokens: number;
  /** null leaves the provider's default (some providers do not accept it at all). */
  temperature: number | null;
}
export interface GenerateResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: 'end' | 'max_tokens' | 'refusal' | 'other';
}
export interface GenerateOptions {
  /** Called with each new piece of text (a non-streaming adapter calls it once). */
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}
export interface LLMProvider {
  readonly id: AiProvider;
  generate(req: GenerateRequest, opts?: GenerateOptions): Promise<GenerateResult>;
  /** Model ids this key can use (also the "Test connection" probe). */
  listModels(): Promise<string[]>;
}
export interface EmbedResult {
  vectors: number[][];
  tokens: number;
}
export interface EmbeddingProvider {
  readonly id: EmbeddingProviderId;
  embed(texts: string[], model: string): Promise<EmbedResult>;
  listModels(): Promise<string[]>;
}

/** How to reach a provider: the decrypted key (server memory only) and an optional endpoint. */
export interface ProviderConnection {
  apiKey: string | null;
  baseUrl: string | null;
  /** True only for an endpoint the platform owner allowlisted (AI_PRIVATE_ENDPOINTS). */
  allowPrivateNetwork: boolean;
  fetcher: typeof safeFetch;
}

export type ProviderErrorKind = 'auth' | 'rate_limit' | 'unavailable' | 'bad_request' | 'network';
/** A provider failure with a short, key-free message that is safe to show an admin. */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
  get retryable() {
    return this.kind === 'rate_limit' || this.kind === 'unavailable' || this.kind === 'network';
  }
}

/** Removes the key and anything key-shaped from text (providers sometimes echo part of a key). */
export function redactSecrets(text: string, ...secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('[redacted]');
  return out
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{6,}/g, '[redacted]')
    .replace(/\bsk-ant-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bAIza[0-9A-Za-z_-]{10,}/g, '[redacted]')
    .replace(/\b(Bearer|key=)\s*[A-Za-z0-9._-]{8,}/gi, '$1 [redacted]');
}

const KIND_BY_STATUS = (status: number): ProviderErrorKind =>
  status === 401 || status === 403
    ? 'auth'
    : status === 429
      ? 'rate_limit'
      : status >= 500 || status === 408 || status === 529
        ? 'unavailable'
        : 'bad_request';

const MESSAGE: Record<ProviderErrorKind, string> = {
  auth: 'The provider rejected the key',
  rate_limit: 'The provider is rate-limiting requests',
  unavailable: 'The provider is unavailable right now',
  bad_request: 'The provider refused the request',
  network: 'Could not reach the provider',
};

/** Pulls a short reason out of a provider's JSON error body, without any secrets. */
function reasonOf(body: Buffer, secrets: (string | null)[]): string {
  try {
    const j = JSON.parse(body.toString('utf8')) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    const raw =
      typeof j.error === 'string'
        ? j.error
        : typeof j.error?.message === 'string'
          ? j.error.message
          : typeof j.message === 'string'
            ? j.message
            : '';
    return redactSecrets(raw, ...secrets).slice(0, 160);
  } catch {
    return '';
  }
}

export interface JsonCall {
  method?: SafeMethod;
  headers?: Record<string, string>;
  body?: unknown;
  /** A pre-encoded body (multipart uploads); set its content-type in `headers`. */
  rawBody?: Buffer;
  timeoutMs?: number;
  maxBytes?: number;
}

/** One JSON request to a provider through the SSRF-safe fetcher, with errors mapped and redacted. */
export async function callJson<T>(conn: ProviderConnection, url: string, call: JsonCall = {}): Promise<T> {
  let res;
  try {
    res = await conn.fetcher(url, {
      method: call.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(call.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...call.headers,
      },
      ...(call.rawBody
        ? { body: call.rawBody }
        : call.body !== undefined
          ? { body: JSON.stringify(call.body) }
          : {}),
      timeoutMs: call.timeoutMs ?? 30_000,
      maxBytes: call.maxBytes ?? 4 * 1024 * 1024,
      maxRedirects: 0,
      allowPrivateNetwork: conn.allowPrivateNetwork,
    });
  } catch (e) {
    const why = e instanceof SafeFetchError ? e.message : 'Could not reach the provider';
    throw new ProviderError('network', redactSecrets(why, conn.apiKey));
  }
  if (res.status < 200 || res.status >= 300) {
    const kind = KIND_BY_STATUS(res.status);
    const reason = reasonOf(res.body, [conn.apiKey]);
    const retry = Number(res.headers?.['retry-after']);
    throw new ProviderError(
      kind,
      reason ? `${MESSAGE[kind]} (${res.status}): ${reason}` : `${MESSAGE[kind]} (${res.status})`,
      res.status,
      Number.isFinite(retry) && retry > 0 ? Math.min(retry, 60) * 1000 : null,
    );
  }
  try {
    return JSON.parse(res.body.toString('utf8')) as T;
  } catch {
    throw new ProviderError('bad_request', 'The provider sent a response we could not read');
  }
}

/** Joins a base URL and a path without doubling or dropping slashes. */
export const joinUrl = (base: string, path: string) =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

export const requireKey = (conn: ProviderConnection): string => {
  if (!conn.apiKey) throw new ProviderError('auth', 'No API key is set');
  return conn.apiKey;
};
