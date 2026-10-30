/**
 * Live AI smoke test (build B11): with real keys in env, runs one answer, one embedding and one
 * `/quiz` per configured provider and prints the token counts. Not part of CI (it spends tokens and
 * needs the network); it closes the "providers tested only against fakes" gap in phase-9.md.
 *
 *   pnpm --filter @campuslink/api ai:smoke
 *
 * Providers come from the platform default (AI_DEFAULT_*) and, to try others in the same run, from
 * ANTHROPIC_API_KEY, OPENAI_API_KEY and GEMINI_API_KEY with ANTHROPIC_MODEL, OPENAI_MODEL,
 * GEMINI_MODEL and OPENAI_EMBEDDING_MODEL, GEMINI_EMBEDDING_MODEL (Anthropic defaults to its answer
 * model; the others need a model named, as the app never guesses one). Keys are never printed.
 */
import {
  DEFAULT_CHAT_MODEL,
  type AiProvider,
  type EmbeddingProvider as EmbeddingProviderId,
} from '@campuslink/shared';
import { loadEnv } from '../config/env.js';
import { safeFetch } from '../lib/safe-fetch.js';
import { chatProvider, embeddingProvider } from '../modules/study/ai/registry.js';
import { buildMessages, systemPrompt, type PromptSource } from '../modules/study/chat/prompt.js';
import { redactSecrets, type ProviderConnection } from '../modules/study/ai/provider.js';

interface Target {
  label: string;
  chat: { id: AiProvider; model: string } | null;
  embed: { id: EmbeddingProviderId; model: string } | null;
  conn: ProviderConnection;
}

const env = loadEnv();
const conn = (apiKey: string | null, baseUrl: string | null = null): ProviderConnection => ({
  apiKey,
  baseUrl,
  allowPrivateNetwork: !!baseUrl && env.AI_PRIVATE_ENDPOINTS.includes(new URL(baseUrl).origin),
  fetcher: safeFetch,
});

const targets: Target[] = [];
if (env.AI_DEFAULT_PROVIDER) {
  targets.push({
    label: `platform default (${env.AI_DEFAULT_PROVIDER})`,
    chat: {
      id: env.AI_DEFAULT_PROVIDER,
      model: env.AI_DEFAULT_CHAT_MODEL || DEFAULT_CHAT_MODEL[env.AI_DEFAULT_PROVIDER],
    },
    embed:
      env.AI_DEFAULT_EMBEDDING_PROVIDER && env.AI_DEFAULT_EMBEDDING_MODEL
        ? { id: env.AI_DEFAULT_EMBEDDING_PROVIDER, model: env.AI_DEFAULT_EMBEDDING_MODEL }
        : null,
    conn: conn(env.AI_DEFAULT_API_KEY ?? null, env.AI_DEFAULT_BASE_URL ?? null),
  });
}
const extra = (
  id: 'anthropic' | 'openai' | 'gemini',
  key: string | undefined,
  model: string | undefined,
  embedModel?: string,
) => {
  if (!key) return;
  const chatModel = model || DEFAULT_CHAT_MODEL[id];
  targets.push({
    label: id,
    chat: chatModel ? { id, model: chatModel } : null,
    embed: id !== 'anthropic' && embedModel ? { id, model: embedModel } : null,
    conn: conn(key),
  });
};
extra('anthropic', process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_MODEL);
extra('openai', process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL, process.env.OPENAI_EMBEDDING_MODEL);
extra('gemini', process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL, process.env.GEMINI_EMBEDDING_MODEL);

/** A short, fictional passage: the same material for every provider. */
const SOURCES: PromptSource[] = [
  {
    n: 1,
    title: 'Demo notes: centrifugal pumps',
    where: 'page 1',
    text: 'A centrifugal pump converts the kinetic energy of a rotating impeller into pressure energy. Cavitation happens when the local pressure at the impeller eye falls below the vapour pressure of the liquid; it is avoided by keeping the available NPSH above the required NPSH.',
  },
];
const secrets = [
  env.AI_DEFAULT_API_KEY,
  process.env.ANTHROPIC_API_KEY,
  process.env.OPENAI_API_KEY,
  process.env.GEMINI_API_KEY,
];
const safe = (e: unknown) => redactSecrets(e instanceof Error ? e.message : String(e), ...secrets);

async function main() {
  if (!targets.length) {
    console.warn(
      'No provider configured: set AI_DEFAULT_PROVIDER (and its key) or ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY.',
    );
    process.exitCode = 1;
    return;
  }
  let failed = 0;
  for (const t of targets) {
    console.warn(`\n== ${t.label}`);
    if (t.chat) {
      const llm = chatProvider(t.chat.id, t.conn);
      for (const task of [{ kind: 'answer' as const }, { kind: 'quiz' as const, count: 3 }]) {
        const started = Date.now();
        try {
          const r = await llm.generate({
            model: t.chat.model,
            system: systemPrompt(task, 'simple', 'en'),
            messages: buildMessages({
              history: [],
              sources: SOURCES,
              question: task.kind === 'quiz' ? '/quiz' : 'What causes cavitation and how is it avoided?',
            }),
            maxTokens: 400,
            temperature: null,
          });
          console.warn(
            `  ${task.kind === 'quiz' ? '/quiz ' : 'answer'}  ${t.chat.model}: ${r.inputTokens} in, ${r.outputTokens} out, ${Date.now() - started} ms, stop ${r.stopReason}, ${r.text.length} chars`,
          );
        } catch (e) {
          failed++;
          console.warn(`  ${task.kind} failed: ${safe(e)}`);
        }
      }
    } else console.warn('  chat: no model named (set the provider’s *_MODEL)');
    if (t.embed) {
      try {
        const r = await embeddingProvider(t.embed.id, t.conn).embed([SOURCES[0]?.text ?? ''], t.embed.model);
        console.warn(
          `  embed   ${t.embed.model}: ${r.tokens} tokens, ${r.vectors[0]?.length ?? 0} dimensions`,
        );
      } catch (e) {
        failed++;
        console.warn(`  embed failed: ${safe(e)}`);
      }
    } else console.warn('  embeddings: not configured for this provider');
  }
  if (failed) process.exitCode = 1;
}

void main();
