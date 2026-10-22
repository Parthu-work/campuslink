import type { MaterialVisibility } from '@campuslink/shared';
import type { ScopedFilter, VectorHit, VectorPoint, VectorStore } from './store.js';

/**
 * A documented starting point for MongoDB Atlas Vector Search, for a deployment on Atlas that would
 * rather not run Qdrant. It is not wired into `createVectorStore` and every method refuses to run.
 *
 * To finish it:
 * 1. Keep the vectors where they already are (`contentChunks.vector`, float32 bytes) or add a
 *    numeric-array copy, and create an Atlas Vector Search index on it with `tenantId`, `subjectId`,
 *    `model`, `visibility`, `unitId`, `topicIds`, `materialId` and `materialType` as filter fields.
 * 2. `search` must run `$vectorSearch` as the first stage with `filter` built from every field of the
 *    `ScopedFilter` (tenant, subjects, model and visibility always). The tenant plugin adds a `$match`
 *    in front of tenant-context aggregates, which `$vectorSearch` does not allow, so run it through a
 *    named platform path (`withPlatformScope('study:vector-search', …)`) that sets the tenant filter
 *    itself, and add that path to the tenancy tests.
 * 3. `upsert`, `deleteMaterial`, `setVisibility` and `deleteOtherModels` become updates of the chunk
 *    documents; `count` a count of chunks with a vector of that model.
 * 4. Run the vector-store contract tests (`test/vector-store.test.ts`) against it.
 */
export class AtlasVectorStore implements VectorStore {
  readonly id = 'atlas';
  private refuse(): never {
    throw new Error('AtlasVectorStore is a documented starting point, not an implementation');
  }
  upsert(_points: VectorPoint[]): Promise<void> {
    return this.refuse();
  }
  search(_vector: number[], _f: ScopedFilter, _limit: number): Promise<VectorHit[]> {
    return this.refuse();
  }
  deleteMaterial(_tenantId: string, _materialId: string): Promise<void> {
    return this.refuse();
  }
  deleteOtherModels(_tenantId: string, _keep: string): Promise<void> {
    return this.refuse();
  }
  setVisibility(_tenantId: string, _materialId: string, _visibility: MaterialVisibility): Promise<void> {
    return this.refuse();
  }
  count(_tenantId: string, _model: string): Promise<number> {
    return this.refuse();
  }
}
