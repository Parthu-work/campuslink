import type { MaterialVisibility } from '@campuslink/shared';
import { callJson, joinUrl, type ProviderConnection } from '../ai/provider.js';
import {
  assertScoped,
  assertTenant,
  type ScopedFilter,
  type VectorHit,
  type VectorPoint,
  type VectorStore,
} from './store.js';

const KEYWORD_FIELDS = [
  'subjectId',
  'materialId',
  'materialType',
  'unitId',
  'topicIds',
  'visibility',
  'model',
];

/** Qdrant ids are unsigned integers or UUIDs: a passage's 24-hex id becomes a UUID (and back). */
export const toPointId = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 24)}00000000`;

type Condition = { key: string; match: { value: string } } | { key: string; match: { any: string[] } };

/** The Qdrant filter for a scoped search: tenant, subjects, model and visibility always. */
export function toQdrantFilter(f: ScopedFilter): { must: Condition[] } {
  const must: Condition[] = [
    { key: 'tenantId', match: { value: f.tenantId } },
    { key: 'subjectId', match: { any: f.subjectIds } },
    { key: 'model', match: { value: f.model } },
    { key: 'visibility', match: { any: f.visibility } },
  ];
  if (f.unitId) must.push({ key: 'unitId', match: { value: f.unitId } });
  if (f.topicId) must.push({ key: 'topicIds', match: { value: f.topicId } });
  if (f.materialIds) must.push({ key: 'materialId', match: { any: f.materialIds } });
  if (f.materialTypes) must.push({ key: 'materialType', match: { any: f.materialTypes } });
  return { must };
}

/**
 * Qdrant over its REST API, through the SSRF-safe fetcher (the address is the platform owner's
 * `QDRANT_URL`, so it may be private). One collection per vector size, shared by colleges and
 * partitioned by `tenantId` (a tenant index); every request carries the tenant in its filter.
 */
export class QdrantVectorStore implements VectorStore {
  readonly id = 'qdrant';
  private readonly ready = new Map<number, Promise<void>>();

  constructor(
    private readonly conn: ProviderConnection,
    private readonly prefix = 'campuslink_passages',
  ) {}

  private call<T>(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown) {
    return callJson<T>(this.conn, joinUrl(this.conn.baseUrl ?? '', path), {
      method,
      ...(body !== undefined ? { body } : {}),
      headers: this.conn.apiKey ? { 'api-key': this.conn.apiKey } : {},
      timeoutMs: 15_000,
      maxBytes: 8 * 1024 * 1024,
    });
  }

  private collection(dims: number) {
    return `${this.prefix}_${dims}`;
  }

  /** Our collections (one per vector size). */
  private async collections(): Promise<string[]> {
    const r = await this.call<{ result?: { collections?: { name: string }[] } }>('collections', 'GET');
    return (r.result?.collections ?? []).map((c) => c.name).filter((n) => n.startsWith(`${this.prefix}_`));
  }

  private ensure(dims: number): Promise<void> {
    let p = this.ready.get(dims);
    if (!p) {
      const name = this.collection(dims);
      p = (async () => {
        const r = await this.call<{ result?: { exists?: boolean } }>(`collections/${name}/exists`, 'GET');
        if (r.result?.exists) return;
        await this.call(`collections/${name}`, 'PUT', { vectors: { size: dims, distance: 'Cosine' } });
        await this.call(`collections/${name}/index?wait=true`, 'PUT', {
          field_name: 'tenantId',
          field_schema: { type: 'keyword', is_tenant: true },
        });
        for (const field of KEYWORD_FIELDS)
          await this.call(`collections/${name}/index?wait=true`, 'PUT', {
            field_name: field,
            field_schema: 'keyword',
          });
      })();
      p.catch(() => this.ready.delete(dims));
      this.ready.set(dims, p);
    }
    return p;
  }

  async upsert(points: VectorPoint[]) {
    if (!points.length) return;
    for (const p of points) assertTenant(p.payload.tenantId);
    const bySize = new Map<number, VectorPoint[]>();
    for (const p of points) bySize.set(p.vector.length, [...(bySize.get(p.vector.length) ?? []), p]);
    for (const [dims, group] of bySize) {
      await this.ensure(dims);
      await this.call(`collections/${this.collection(dims)}/points?wait=true`, 'PUT', {
        points: group.map((p) => ({
          id: toPointId(p.id),
          vector: p.vector,
          payload: { ...p.payload, passageId: p.id },
        })),
      });
    }
  }

  async search(vector: number[], f: ScopedFilter, limit: number): Promise<VectorHit[]> {
    assertScoped(f);
    if (!f.subjectIds.length || !vector.length) return [];
    const name = this.collection(vector.length);
    const exists = await this.call<{ result?: { exists?: boolean } }>(`collections/${name}/exists`, 'GET');
    if (!exists.result?.exists) return [];
    const r = await this.call<{
      result?: { points?: { score: number; payload?: { passageId?: string; tenantId?: string } }[] };
    }>(`collections/${name}/points/query`, 'POST', {
      query: vector,
      filter: toQdrantFilter(f),
      limit,
      with_payload: ['passageId', 'tenantId'],
    });
    return (r.result?.points ?? [])
      .filter((p) => p.payload?.tenantId === f.tenantId && typeof p.payload.passageId === 'string')
      .map((p) => ({ id: p.payload?.passageId ?? '', score: p.score }));
  }

  private async eachCollection(fn: (name: string) => Promise<unknown>) {
    for (const name of await this.collections()) await fn(name);
  }

  async deleteMaterial(tenantId: string, materialId: string) {
    assertTenant(tenantId);
    await this.eachCollection((name) =>
      this.call(`collections/${name}/points/delete?wait=true`, 'POST', {
        filter: {
          must: [
            { key: 'tenantId', match: { value: tenantId } },
            { key: 'materialId', match: { value: materialId } },
          ],
        },
      }),
    );
  }

  async deleteOtherModels(tenantId: string, keep: string) {
    assertTenant(tenantId);
    await this.eachCollection((name) =>
      this.call(`collections/${name}/points/delete?wait=true`, 'POST', {
        filter: {
          must: [{ key: 'tenantId', match: { value: tenantId } }],
          must_not: [{ key: 'model', match: { value: keep } }],
        },
      }),
    );
  }

  async setVisibility(tenantId: string, materialId: string, visibility: MaterialVisibility) {
    assertTenant(tenantId);
    await this.eachCollection((name) =>
      this.call(`collections/${name}/points/payload?wait=true`, 'POST', {
        payload: { visibility },
        filter: {
          must: [
            { key: 'tenantId', match: { value: tenantId } },
            { key: 'materialId', match: { value: materialId } },
          ],
        },
      }),
    );
  }

  async count(tenantId: string, model: string) {
    assertTenant(tenantId);
    let n = 0;
    await this.eachCollection(async (name) => {
      const r = await this.call<{ result?: { count?: number } }>(`collections/${name}/points/count`, 'POST', {
        filter: {
          must: [
            { key: 'tenantId', match: { value: tenantId } },
            { key: 'model', match: { value: model } },
          ],
        },
        exact: true,
      });
      n += r.result?.count ?? 0;
    });
    return n;
  }
}
