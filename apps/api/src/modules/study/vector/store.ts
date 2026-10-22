import type { MaterialType, MaterialVisibility } from '@campuslink/shared';
import { requireTenantId } from '../../../lib/context.js';

/** What is stored with every vector; every search filters on `tenantId`, `subjectId` and `model`. */
export interface VectorPayload {
  tenantId: string;
  subjectId: string;
  materialId: string;
  materialType: MaterialType;
  unitId: string | null;
  topicIds: string[];
  visibility: MaterialVisibility;
  /** `provider:model` that made the vector: a search compares only vectors of one model. */
  model: string;
}
/** `id` is the passage (content chunk) id. */
export interface VectorPoint {
  id: string;
  vector: number[];
  payload: VectorPayload;
}
export interface VectorHit {
  id: string;
  /** Cosine similarity, -1 to 1. */
  score: number;
}

/**
 * The only filter a store accepts. `VectorIndex` builds it from the request's tenant and the
 * member's readable subjects; callers never pass a tenant.
 */
export interface ScopedFilter {
  tenantId: string;
  subjectIds: string[];
  model: string;
  visibility: MaterialVisibility[];
  unitId?: string | undefined;
  topicId?: string | undefined;
  materialIds?: string[] | undefined;
  materialTypes?: MaterialType[] | undefined;
}

/**
 * A vector database behind one interface (Qdrant in production, in-memory for tests and single
 * servers; `atlas.ts` documents a MongoDB Atlas alternative). Implementations must refuse a search
 * or a write without a tenant (`assertTenant`).
 */
export interface VectorStore {
  readonly id: 'memory' | 'qdrant' | 'atlas';
  upsert(points: VectorPoint[]): Promise<void>;
  search(vector: number[], filter: ScopedFilter, limit: number): Promise<VectorHit[]>;
  /** Removes a material's vectors (every model). */
  deleteMaterial(tenantId: string, materialId: string): Promise<void>;
  /** Removes a college's vectors made by any model other than `keep` (after a model change). */
  deleteOtherModels(tenantId: string, keep: string): Promise<void>;
  setVisibility(tenantId: string, materialId: string, visibility: MaterialVisibility): Promise<void>;
  /** How many vectors a college has for a model (to notice a lost index). */
  count(tenantId: string, model: string): Promise<number>;
}

const HEX24 = /^[a-f0-9]{24}$/;

/** Throws unless the tenant is a real id: no store may search or write across colleges. */
export function assertTenant(tenantId: unknown): asserts tenantId is string {
  if (typeof tenantId !== 'string' || !HEX24.test(tenantId))
    throw new Error('Vector store call without a tenant filter');
}

/** Throws unless the filter names a tenant, the readable subjects and the model. */
export function assertScoped(f: ScopedFilter | undefined): asserts f is ScopedFilter {
  if (!f) throw new Error('Vector search without a filter');
  assertTenant(f.tenantId);
  if (!Array.isArray(f.subjectIds) || !f.subjectIds.every((s) => HEX24.test(s)))
    throw new Error('Vector search without a subject filter');
  if (typeof f.model !== 'string' || !f.model) throw new Error('Vector search without a model');
  if (!Array.isArray(f.visibility) || !f.visibility.length)
    throw new Error('Vector search without a visibility filter');
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>, normB?: number): number {
  if (a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    if (normB === undefined) nb += y * y;
  }
  const d = Math.sqrt(na) * (normB ?? Math.sqrt(nb));
  return d ? dot / d : 0;
}

const norm = (v: ArrayLike<number>) => {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += (v[i] ?? 0) ** 2;
  return Math.sqrt(n);
};

interface Stored {
  vector: Float32Array;
  norm: number;
  payload: VectorPayload;
}

/**
 * Exact search in process memory, per college. The vectors themselves are kept on the passages in
 * MongoDB, so after a restart a college's vectors are loaded again (`load`) the first time they are
 * needed. Right for tests, development and a single API server; with several servers use Qdrant,
 * since each process would only see the vectors it wrote itself.
 */
export class MemoryVectorStore implements VectorStore {
  readonly id = 'memory';
  private readonly byTenant = new Map<string, Map<string, Stored>>();
  private readonly loading = new Map<string, Promise<Map<string, Stored>>>();

  constructor(private readonly load: (tenantId: string) => Promise<VectorPoint[]> = async () => []) {}

  private async tenant(tenantId: string): Promise<Map<string, Stored>> {
    assertTenant(tenantId);
    const have = this.byTenant.get(tenantId);
    if (have) return have;
    let p = this.loading.get(tenantId);
    if (!p) {
      p = this.load(tenantId).then((points) => {
        const m = this.byTenant.get(tenantId) ?? new Map<string, Stored>();
        for (const pt of points)
          if (pt.payload.tenantId === tenantId && !m.has(pt.id)) m.set(pt.id, toStored(pt));
        this.byTenant.set(tenantId, m);
        return m;
      });
      this.loading.set(tenantId, p);
      p.finally(() => this.loading.delete(tenantId)).catch(() => undefined);
    }
    return p;
  }

  async upsert(points: VectorPoint[]) {
    for (const p of points) {
      assertTenant(p.payload.tenantId);
      (await this.tenant(p.payload.tenantId)).set(p.id, toStored(p));
    }
  }

  async search(vector: number[], f: ScopedFilter, limit: number): Promise<VectorHit[]> {
    assertScoped(f);
    if (!f.subjectIds.length) return [];
    const subjects = new Set(f.subjectIds);
    const vis = new Set<string>(f.visibility);
    const mats = f.materialIds ? new Set(f.materialIds) : null;
    const types = f.materialTypes ? new Set<string>(f.materialTypes) : null;
    const hits: VectorHit[] = [];
    for (const [id, s] of await this.tenant(f.tenantId)) {
      const p = s.payload;
      if (p.tenantId !== f.tenantId || p.model !== f.model || !subjects.has(p.subjectId)) continue;
      if (!vis.has(p.visibility)) continue;
      if (f.unitId && p.unitId !== f.unitId) continue;
      if (f.topicId && !p.topicIds.includes(f.topicId)) continue;
      if (mats && !mats.has(p.materialId)) continue;
      if (types && !types.has(p.materialType)) continue;
      hits.push({ id, score: cosine(vector, s.vector, s.norm) });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async deleteMaterial(tenantId: string, materialId: string) {
    const m = await this.tenant(tenantId);
    for (const [id, s] of m) if (s.payload.materialId === materialId) m.delete(id);
  }

  async deleteOtherModels(tenantId: string, keep: string) {
    const m = await this.tenant(tenantId);
    for (const [id, s] of m) if (s.payload.model !== keep) m.delete(id);
  }

  async setVisibility(tenantId: string, materialId: string, visibility: MaterialVisibility) {
    for (const s of (await this.tenant(tenantId)).values())
      if (s.payload.materialId === materialId) s.payload = { ...s.payload, visibility };
  }

  async count(tenantId: string, model: string) {
    let n = 0;
    for (const s of (await this.tenant(tenantId)).values()) if (s.payload.model === model) n++;
    return n;
  }

  /** Forgets everything (tests simulate a restart or a lost index with it). */
  clear() {
    this.byTenant.clear();
  }
}

function toStored(p: VectorPoint): Stored {
  const vector = Float32Array.from(p.vector);
  return { vector, norm: norm(vector), payload: { ...p.payload, topicIds: [...p.payload.topicIds] } };
}

const tenant = () => String(requireTenantId());

export interface IndexScope {
  /** The member's readable subjects (from `SubjectsService.readableIds`), already narrowed. */
  subjectIds: string[];
  model: string;
  unitId?: string | undefined;
  topicId?: string | undefined;
  materialIds?: string[] | undefined;
  materialTypes?: MaterialType[] | undefined;
}

/**
 * The repository layer over a store: the tenant always comes from the request or job context
 * (`requireTenantId`, which throws outside one), and searches only ever see published material in
 * the subjects passed. Services use this, never a store directly.
 */
export class VectorIndex {
  constructor(readonly store: VectorStore) {}

  async search(vector: number[], scope: IndexScope, limit: number) {
    return this.store.search(
      vector,
      {
        tenantId: tenant(),
        subjectIds: scope.subjectIds,
        model: scope.model,
        visibility: ['published'],
        unitId: scope.unitId,
        topicId: scope.topicId,
        materialIds: scope.materialIds,
        materialTypes: scope.materialTypes,
      },
      limit,
    );
  }

  async upsert(points: { id: string; vector: number[]; payload: Omit<VectorPayload, 'tenantId'> }[]) {
    const tenantId = tenant();
    return this.store.upsert(points.map((p) => ({ ...p, payload: { ...p.payload, tenantId } })));
  }

  async deleteMaterial(materialId: string) {
    return this.store.deleteMaterial(tenant(), materialId);
  }

  async deleteOtherModels(keep: string) {
    return this.store.deleteOtherModels(tenant(), keep);
  }

  async setVisibility(materialId: string, visibility: MaterialVisibility) {
    return this.store.setVisibility(tenant(), materialId, visibility);
  }

  async count(model: string) {
    return this.store.count(tenant(), model);
  }
}
