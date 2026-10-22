import type { Env } from '../../../config/env.js';
import { runInTenant } from '../../../lib/context.js';
import type { safeFetch } from '../../../lib/safe-fetch.js';
import { storedVectors } from '../indexing.service.js';
import { QdrantVectorStore } from './qdrant.js';
import { MemoryVectorStore, type VectorStore } from './store.js';

/** Qdrant when configured (`VECTOR_STORE=qdrant`, or `auto` with QDRANT_URL); otherwise in memory. */
export function createVectorStore(
  env: Pick<Env, 'VECTOR_STORE' | 'QDRANT_URL' | 'QDRANT_API_KEY'>,
  fetcher: typeof safeFetch,
): VectorStore {
  if (env.VECTOR_STORE === 'qdrant' || (env.VECTOR_STORE === 'auto' && env.QDRANT_URL)) {
    if (!env.QDRANT_URL) throw new Error('VECTOR_STORE=qdrant needs QDRANT_URL');
    return new QdrantVectorStore({
      apiKey: env.QDRANT_API_KEY ?? null,
      baseUrl: env.QDRANT_URL,
      // Platform-owned service from the environment, typically on the private network.
      allowPrivateNetwork: true,
      fetcher,
    });
  }
  return new MemoryVectorStore((tenantId) => runInTenant(tenantId, () => storedVectors()));
}
