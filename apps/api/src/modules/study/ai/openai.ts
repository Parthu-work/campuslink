import {
  callJson,
  callSse,
  joinUrl,
  ProviderError,
  requireKey,
  type EmbeddingProvider,
  type GenerateOptions,
  type GenerateRequest,
  type GenerateResult,
  type LLMProvider,
  type ProviderConnection,
} from './provider.js';

const OPENAI = 'https://api.openai.com/v1';

interface ChatCompletion {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
interface Embeddings {
  data?: { embedding?: number[]; index?: number }[];
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

/** OpenAI, or an OpenAI-compatible server (vLLM, Ollama, LM Studio…) when `custom` is set. */
function base(conn: ProviderConnection, custom: boolean): string {
  if (!custom) return OPENAI;
  if (!conn.baseUrl) throw new ProviderError('bad_request', 'Enter the endpoint address first');
  return conn.baseUrl;
}
/** Local OpenAI-compatible servers often run without a key. */
const auth = (conn: ProviderConnection, custom: boolean): Record<string, string> =>
  custom && !conn.apiKey ? {} : { authorization: `Bearer ${requireKey(conn)}` };

async function models(conn: ProviderConnection, custom: boolean) {
  const r = await callJson<{ data?: { id?: string }[] }>(conn, joinUrl(base(conn, custom), 'models'), {
    headers: auth(conn, custom),
    timeoutMs: 10_000,
  });
  return (r.data ?? []).map((m) => m.id ?? '').filter(Boolean);
}

export function openaiChat(conn: ProviderConnection, custom = false): LLMProvider {
  return {
    id: custom ? 'openai_compatible' : 'openai',
    listModels: () => models(conn, custom),
    async generate(req: GenerateRequest, opts: GenerateOptions = {}): Promise<GenerateResult> {
      const url = joinUrl(base(conn, custom), 'chat/completions');
      const call = {
        method: 'POST' as const,
        headers: auth(conn, custom),
        timeoutMs: 90_000,
        signal: opts.signal,
      };
      const body = {
        model: req.model,
        messages: [{ role: 'system', content: req.system }, ...req.messages],
        // OpenAI's current parameter; compatible servers still expect max_tokens.
        ...(custom ? { max_tokens: req.maxTokens } : { max_completion_tokens: req.maxTokens }),
        ...(req.temperature !== null ? { temperature: req.temperature } : {}),
      };
      if (opts.onText) return streamChat(conn, url, call, body, opts.onText);
      const r = await callJson<ChatCompletion>(conn, url, { ...call, body });
      const choice = r.choices?.[0];
      const usage = {
        inputTokens: r.usage?.prompt_tokens ?? 0,
        outputTokens: r.usage?.completion_tokens ?? 0,
      };
      if (choice?.message?.refusal) return { text: '', ...usage, stopReason: 'refusal' };
      const text = choice?.message?.content ?? '';
      if (!text && choice?.finish_reason !== 'length')
        throw new ProviderError('bad_request', 'The provider returned no answer');
      return { text, ...usage, stopReason: finish(choice?.finish_reason) };
    },
  };
}

const finish = (reason: string | null | undefined): GenerateResult['stopReason'] =>
  reason === 'length' ? 'max_tokens' : reason === 'content_filter' ? 'refusal' : 'end';

interface ChatChunk {
  choices?: { delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/** Chat completions as server-sent events (`data: [DONE]` ends them); usage comes last. */
async function streamChat(
  conn: ProviderConnection,
  url: string,
  call: {
    method: 'POST';
    headers: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal | undefined;
  },
  body: Record<string, unknown>,
  onText: (delta: string) => void,
): Promise<GenerateResult> {
  let text = '';
  let refused = false;
  let reason: string | null = null;
  let usage = { inputTokens: 0, outputTokens: 0 };
  await callSse(
    conn,
    url,
    { ...call, body: { ...body, stream: true, stream_options: { include_usage: true } } },
    (e) => {
      if (e.data === '[DONE]') return;
      let c: ChatChunk;
      try {
        c = JSON.parse(e.data) as ChatChunk;
      } catch {
        return;
      }
      const ch = c.choices?.[0];
      if (ch?.delta?.refusal) refused = true;
      if (ch?.delta?.content) {
        text += ch.delta.content;
        onText(ch.delta.content);
      }
      if (ch?.finish_reason) reason = ch.finish_reason;
      if (c.usage)
        usage = { inputTokens: c.usage.prompt_tokens ?? 0, outputTokens: c.usage.completion_tokens ?? 0 };
    },
  );
  if (refused) return { text: '', ...usage, stopReason: 'refusal' };
  if (!text && reason !== 'length') throw new ProviderError('bad_request', 'The provider returned no answer');
  return { text, ...usage, stopReason: finish(reason) };
}

export function openaiEmbeddings(conn: ProviderConnection, custom = false): EmbeddingProvider {
  return {
    id: custom ? 'openai_compatible' : 'openai',
    listModels: () => models(conn, custom),
    async embed(texts: string[], model: string) {
      const r = await callJson<Embeddings>(conn, joinUrl(base(conn, custom), 'embeddings'), {
        method: 'POST',
        headers: auth(conn, custom),
        timeoutMs: 60_000,
        maxBytes: 32 * 1024 * 1024,
        body: { model, input: texts },
      });
      const rows = [...(r.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (rows.length !== texts.length || rows.some((x) => !x.embedding?.length))
        throw new ProviderError('bad_request', 'The provider returned the wrong number of embeddings');
      return {
        vectors: rows.map((x) => x.embedding ?? []),
        tokens: r.usage?.total_tokens ?? r.usage?.prompt_tokens ?? 0,
      };
    },
  };
}
