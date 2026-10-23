import {
  callJson,
  callSse,
  ProviderError,
  requireKey,
  type EmbeddingProvider,
  type GenerateOptions,
  type GenerateRequest,
  type GenerateResult,
  type LLMProvider,
  type ProviderConnection,
} from './provider.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GenerateContent {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
interface ModelList {
  models?: { name?: string; supportedGenerationMethods?: string[] }[];
}

/** Model ids are sent bare ("gemini-…"); the API names them "models/gemini-…". */
const bare = (name: string) => name.replace(/^models\//, '');
const modelPath = (model: string) => `models/${encodeURIComponent(bare(model))}`;

async function listBy(conn: ProviderConnection, method: string) {
  const r = await callJson<ModelList>(conn, `${BASE}/models?pageSize=200`, {
    headers: { 'x-goog-api-key': requireKey(conn) },
    timeoutMs: 10_000,
  });
  return (r.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes(method))
    .map((m) => bare(m.name ?? ''))
    .filter(Boolean);
}

/** Google Gemini through the Generative Language API (the key travels in a header, never the URL). */
export function geminiChat(conn: ProviderConnection): LLMProvider {
  return {
    id: 'gemini',
    listModels: () => listBy(conn, 'generateContent'),
    async generate(req: GenerateRequest, opts: GenerateOptions = {}): Promise<GenerateResult> {
      const call = {
        method: 'POST' as const,
        headers: { 'x-goog-api-key': requireKey(conn) },
        timeoutMs: 90_000,
        signal: opts.signal,
        body: {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: req.messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            maxOutputTokens: req.maxTokens,
            ...(req.temperature !== null ? { temperature: req.temperature } : {}),
          },
        },
      };
      if (opts.onText) {
        // The same response objects, one per server-sent event.
        const onText = opts.onText;
        const acc: GenerateContent = { candidates: [{ content: { parts: [] } }] };
        await callSse(conn, `${BASE}/${modelPath(req.model)}:streamGenerateContent?alt=sse`, call, (e) => {
          let r: GenerateContent;
          try {
            r = JSON.parse(e.data) as GenerateContent;
          } catch {
            return;
          }
          const c = r.candidates?.[0];
          const piece = (c?.content?.parts ?? [])
            .filter((p) => !p.thought)
            .map((p) => p.text ?? '')
            .join('');
          if (piece) {
            acc.candidates?.[0]?.content?.parts?.push({ text: piece });
            onText(piece);
          }
          if (c?.finishReason && acc.candidates?.[0]) acc.candidates[0].finishReason = c.finishReason;
          if (r.promptFeedback) acc.promptFeedback = r.promptFeedback;
          if (r.usageMetadata) acc.usageMetadata = r.usageMetadata;
        });
        return result(acc);
      }
      return result(
        await callJson<GenerateContent>(conn, `${BASE}/${modelPath(req.model)}:generateContent`, call),
      );
    },
  };
}

const REFUSALS = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']);

function result(r: GenerateContent): GenerateResult {
  const usage = {
    inputTokens: r.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: r.usageMetadata?.candidatesTokenCount ?? 0,
  };
  const c = r.candidates?.[0];
  if (r.promptFeedback?.blockReason || REFUSALS.has(c?.finishReason ?? ''))
    return { text: '', ...usage, stopReason: 'refusal' };
  const text = (c?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('');
  if (!text && c?.finishReason !== 'MAX_TOKENS')
    throw new ProviderError('bad_request', 'The provider returned no answer');
  return { text, ...usage, stopReason: c?.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end' };
}

export function geminiEmbeddings(conn: ProviderConnection): EmbeddingProvider {
  return {
    id: 'gemini',
    listModels: () => listBy(conn, 'embedContent'),
    async embed(texts: string[], model: string) {
      const r = await callJson<{ embeddings?: { values?: number[] }[] }>(
        conn,
        `${BASE}/${modelPath(model)}:batchEmbedContents`,
        {
          method: 'POST',
          headers: { 'x-goog-api-key': requireKey(conn) },
          timeoutMs: 60_000,
          maxBytes: 32 * 1024 * 1024,
          body: {
            requests: texts.map((t) => ({ model: modelPath(model), content: { parts: [{ text: t }] } })),
          },
        },
      );
      const vectors = (r.embeddings ?? []).map((e) => e.values ?? []);
      if (vectors.length !== texts.length || vectors.some((v) => !v.length))
        throw new ProviderError('bad_request', 'The provider returned the wrong number of embeddings');
      // Gemini does not report embedding usage; estimate it (about four characters per token).
      return { vectors, tokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0) };
    },
  };
}
