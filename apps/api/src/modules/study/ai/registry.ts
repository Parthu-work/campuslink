import type { AiProvider, EmbeddingProvider as EmbeddingProviderId } from '@campuslink/shared';
import type { EmbeddingProvider, LLMProvider, ProviderConnection } from './provider.js';
import { mockChat, mockEmbeddings } from './mock.js';
import { anthropicChat } from './anthropic.js';
import { openaiChat, openaiEmbeddings } from './openai.js';
import { geminiChat, geminiEmbeddings } from './gemini.js';

/** Adding a provider: write its adapter file, then add one line here and one id in packages/shared. */
export function chatProvider(id: AiProvider, conn: ProviderConnection): LLMProvider {
  switch (id) {
    case 'mock':
      return mockChat;
    case 'anthropic':
      return anthropicChat(conn);
    case 'openai':
      return openaiChat(conn);
    case 'openai_compatible':
      return openaiChat(conn, true);
    case 'gemini':
      return geminiChat(conn);
  }
}

export function embeddingProvider(id: EmbeddingProviderId, conn: ProviderConnection): EmbeddingProvider {
  switch (id) {
    case 'mock':
      return mockEmbeddings;
    case 'openai':
      return openaiEmbeddings(conn);
    case 'openai_compatible':
      return openaiEmbeddings(conn, true);
    case 'gemini':
      return geminiEmbeddings(conn);
  }
}
