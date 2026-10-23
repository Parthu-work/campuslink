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
    } else if (/^TASK: (quiz|flashcards)\b/m.test(req.system)) {
      const count = Number(/with (\d+) (questions|cards)/.exec(req.system)?.[1] ?? 5);
      text = /^TASK: quiz/m.test(req.system) ? mockQuiz(prompt, count) : mockCards(prompt, count);
    } else {
      const question = QUESTION.exec(prompt)?.[1] ?? outside;
      // Like a model reading the conversation: a follow-up ("why?") borrows the last question's words.
      const before = [...req.messages.slice(0, -1)].reverse().find((m) => m.role === 'user')?.content ?? '';
      const wanted = new Set(contentWords(question).length ? contentWords(question) : contentWords(before));
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
      let best = picks
        .sort((a, b) => b.score - a.score || a.at - b.at)
        .slice(0, 3)
        .sort((a, b) => a.at - b.at);
      // "Explain this": about the first source (the passage the member selected).
      const first = SOURCE.exec(prompt);
      SOURCE.lastIndex = 0;
      if (!best.length && /\b(this|that|it|these|those)\b|ఇది|అది/i.test(question) && first)
        best = (first[2] ?? '')
          .split(/(?<=[.!?])\s+|\n+/)
          .map((x) => x.trim())
          .filter((x) => x.length > 12)
          .slice(0, 2)
          .map((sentence, at) => ({ sentence, id: first[1] ?? '1', score: 1, at }));
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

/** Sentences of the sources with their source number (for the mock's quizzes and flashcards). */
function sourceSentences(prompt: string): { id: number; sentence: string; key: string }[] {
  const out: { id: number; sentence: string; key: string }[] = [];
  for (const m of prompt.matchAll(SOURCE))
    for (const raw of (m[2] ?? '').split(/(?<=[.!?])\s+|\n+/)) {
      const sentence = raw.trim();
      const words = sentence.match(/[\p{L}][\p{L}\p{M}-]{4,}/gu) ?? [];
      if (words.length < 3) continue;
      const key = [...words].sort((a, b) => b.length - a.length)[0] ?? '';
      out.push({ id: Number(m[1]), sentence, key });
    }
  return out;
}

/** A deterministic quiz from the sources: fill-in-the-blank questions, multiple choice when it can. */
function mockQuiz(prompt: string, count: number): string {
  const all = sourceSentences(prompt);
  const questions = all.slice(0, count).map((s, i) => {
    const q = s.sentence.replace(s.key, '_____');
    const others = [
      ...new Set(all.filter((o) => o.key.toLowerCase() !== s.key.toLowerCase()).map((o) => o.key)),
    ].slice(0, 3);
    if (others.length < 3) return { type: 'short', q, answer: s.key, explain: s.sentence, cite: s.id };
    const at = i % 4;
    const options = [...others];
    options.splice(at, 0, s.key);
    return { type: 'mcq', q, options, answer: at, explain: s.sentence, cite: s.id };
  });
  return JSON.stringify({ questions });
}

function mockCards(prompt: string, count: number): string {
  return JSON.stringify({
    cards: sourceSentences(prompt)
      .slice(0, count)
      .map((s) => ({ front: s.key, back: s.sentence, cite: s.id })),
  });
}
