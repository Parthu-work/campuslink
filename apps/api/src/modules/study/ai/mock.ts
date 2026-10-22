import type {
  EmbeddingProvider,
  GenerateOptions,
  GenerateRequest,
  GenerateResult,
  LLMProvider,
} from './provider.js';
import { contentWords, estimateTokens, fnv1a } from './tokens.js';

export const MOCK_CHAT_MODEL = 'mock-chat-1';
export const MOCK_EMBEDDING_MODEL = 'mock-embed-1';
export const MOCK_DIMENSIONS = 256;
/** What the mock says when it "obeys" an instruction found outside the delimited context. */
export const MOCK_INJECTION_MARKER = 'MOCK-FOLLOWED-AN-INSTRUCTION';

const SOURCE = /<source id="(\d+)"[^>]*>([\s\S]*?)<\/source>/g;
const QUESTION = /<question>([\s\S]*?)<\/question>/;
const TRAP = /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(instructions|rules|prompt)\b/i;

/**
 * The built-in demo responder: no key and no external calls. Answers are extractive and grounded:
 * it quotes the sentences from the supplied sources that share the most words with the question,
 * with `[n]` citations, and says so when nothing matches. Like a naive model, it obeys an
 * instruction that reaches it outside the `<source>` blocks; the injection tests use that trap to
 * prove the prompt builder keeps untrusted material inside them.
 */
export const mockChat: LLMProvider = {
  id: 'mock',
  async listModels() {
    return [MOCK_CHAT_MODEL];
  },
  async generate(req: GenerateRequest, opts: GenerateOptions = {}): Promise<GenerateResult> {
    const prompt = req.messages.at(-1)?.content ?? '';
    const outside = prompt.replace(SOURCE, ' ');
    let text: string;
    if (TRAP.test(outside) || TRAP.test(req.system.replace(SOURCE, ' '))) {
      text = MOCK_INJECTION_MARKER;
    } else {
      const question = QUESTION.exec(prompt)?.[1] ?? outside;
      const wanted = new Set(contentWords(question));
      const picks: { sentence: string; id: string; score: number; at: number }[] = [];
      let at = 0;
      for (const m of prompt.matchAll(SOURCE)) {
        const id = m[1] ?? '';
        for (const sentence of (m[2] ?? '').split(/(?<=[.!?])\s+|\n+/)) {
          const words = contentWords(sentence);
          const score = words.filter((w) => wanted.has(w)).length;
          if (score > 0 && sentence.trim().length > 12)
            picks.push({ sentence: sentence.trim(), id, score, at: at++ });
        }
      }
      const best = picks
        .sort((a, b) => b.score - a.score || a.at - b.at)
        .slice(0, 3)
        .sort((a, b) => a.at - b.at);
      text = best.length
        ? `From your college's material:\n\n${best.map((p) => `- ${p.sentence} [${p.id}]`).join('\n')}`
        : 'The material provided does not cover this. Try a related topic from the syllabus.';
    }
    const words = text.split(/(?<=\s)/);
    const out: string[] = [];
    for (const w of words) {
      if (opts.signal?.aborted) break;
      if (out.join('').length + w.length > req.maxTokens * 4) break;
      out.push(w);
      opts.onText?.(w);
    }
    const final = out.join('');
    return {
      text: final,
      inputTokens: estimateTokens(req.system + req.messages.map((m) => m.content).join('\n')),
      outputTokens: estimateTokens(final),
      stopReason: final.length < text.length ? 'max_tokens' : 'end',
    };
  },
};

/** Deterministic embeddings: hashed content words, signed, L2-normalised (cosine ≈ word overlap). */
export function mockVector(text: string): number[] {
  const v = new Array<number>(MOCK_DIMENSIONS).fill(0);
  for (const w of contentWords(text)) {
    const h = fnv1a(w);
    const i = h % MOCK_DIMENSIONS;
    v[i] = (v[i] ?? 0) + (h & 0x80000000 ? -1 : 1);
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

export const mockEmbeddings: EmbeddingProvider = {
  id: 'mock',
  async listModels() {
    return [MOCK_EMBEDDING_MODEL];
  },
  async embed(texts: string[]) {
    return {
      vectors: texts.map(mockVector),
      tokens: texts.reduce((n, t) => n + estimateTokens(t), 0),
    };
  },
};
