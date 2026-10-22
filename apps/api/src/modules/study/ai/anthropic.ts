import {
  callJson,
  ProviderError,
  requireKey,
  type GenerateOptions,
  type GenerateRequest,
  type GenerateResult,
  type LLMProvider,
  type ProviderConnection,
} from './provider.js';

const BASE = 'https://api.anthropic.com';
/** API version 2026-10-21: sampling parameters (temperature, top_p, top_k) are not accepted. */
const VERSION = '2026-10-21';

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Models where thinking depth is set with `output_config.effort` (Claude 4.6 and later). Study
 * answers use `low`: short thinking keeps answers quick and cheap, and the answer cap holds.
 */
const takesEffort = (model: string) => /^claude-(opus|sonnet|haiku|fable)-(4-[6-9]|[5-9])/.test(model);

/**
 * Anthropic (Claude) chat through the Messages API. Anthropic has no embeddings API, so pair it
 * with another embedding provider (the settings page explains this).
 */
export function anthropicChat(conn: ProviderConnection): LLMProvider {
  const headers = () => ({ 'x-api-key': requireKey(conn), 'anthropic-version': VERSION });
  return {
    id: 'anthropic',
    async listModels() {
      const r = await callJson<{ data?: { id?: string }[] }>(conn, `${BASE}/v1/models?limit=100`, {
        headers: headers(),
        timeoutMs: 10_000,
      });
      return (r.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    },
    async generate(req: GenerateRequest, opts: GenerateOptions = {}): Promise<GenerateResult> {
      const effort = takesEffort(req.model);
      const r = await callJson<MessagesResponse>(conn, `${BASE}/v1/messages`, {
        method: 'POST',
        headers: headers(),
        timeoutMs: 90_000,
        body: {
          model: req.model,
          // Thinking (always on for current models) counts toward max_tokens: leave it room.
          max_tokens: effort ? Math.min(req.maxTokens * 4, 16_000) : req.maxTokens,
          system: req.system,
          messages: req.messages,
          ...(effort ? { output_config: { effort: 'low' } } : {}),
        },
      });
      if (r.stop_reason === 'refusal')
        return {
          text: '',
          inputTokens: r.usage?.input_tokens ?? 0,
          outputTokens: r.usage?.output_tokens ?? 0,
          stopReason: 'refusal',
        };
      const text = (r.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      if (!text && r.stop_reason !== 'max_tokens')
        throw new ProviderError('bad_request', 'The provider returned no answer');
      opts.onText?.(text);
      return {
        text,
        inputTokens: r.usage?.input_tokens ?? 0,
        outputTokens: r.usage?.output_tokens ?? 0,
        stopReason: r.stop_reason === 'max_tokens' ? 'max_tokens' : r.stop_reason ? 'end' : 'other',
      };
    },
  };
}
