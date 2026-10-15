/* eslint-disable @typescript-eslint/no-explicit-any -- Mongoose middleware `this` types differ per hook; checked at runtime and by the isolation suite. */
import type { Schema, PipelineStage, MongooseQueryMiddleware } from 'mongoose';
import { Types } from 'mongoose';
import { getContext, TenantContextError } from '../lib/context.js';

const QUERY_OPS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'countDocuments',
  'deleteOne',
  'deleteMany',
  'updateOne',
  'updateMany',
  'replaceOne',
  'distinct',
] as const;

export const TENANT_PLUGIN_MARK = Symbol.for('campuslink.tenantScoped');

type Scope = { kind: 'tenant'; tenantId: Types.ObjectId } | { kind: 'platform' };

function currentScope(op: string, model: string): Scope {
  const ctx = getContext();
  if (ctx?.tenantId) return { kind: 'tenant', tenantId: ctx.tenantId };
  if (ctx?.platformReason) return { kind: 'platform' };
  throw new TenantContextError(`${model}.${op} called without tenant context`);
}

function sameId(a: unknown, b: Types.ObjectId): boolean {
  return a != null && String(a) === String(b);
}

function touchesTenantId(update: unknown): boolean {
  if (!update || typeof update !== 'object') return false;
  if (Array.isArray(update)) return true; // pipeline updates are not allowed on tenant models
  return Object.entries(update).some(([k, v]) =>
    k === 'tenantId' ? true : k.startsWith('$') && v && typeof v === 'object' && 'tenantId' in v,
  );
}

/**
 * Enforces tenant isolation for every operation on the model: queries and aggregates are filtered,
 * new documents are stamped, cross-tenant writes and tenantId changes throw, and calls without a
 * tenant (or explicit platform) context throw. See docs/adr/0002-shared-database-tenancy.md.
 */
export function tenantPlugin(schema: Schema): void {
  schema.add({ tenantId: { type: Types.ObjectId, required: true, immutable: true, ref: 'Tenant' } });
  (schema as unknown as Record<symbol, boolean>)[TENANT_PLUGIN_MARK] = true;

  schema.pre(
    QUERY_OPS as unknown as MongooseQueryMiddleware[],
    { document: false, query: true },
    function (this: any) {
      const scope = currentScope(this.op, this.model.modelName);
      const update = this.getUpdate?.();
      const isReplace = this.op === 'replaceOne' || this.op === 'findOneAndReplace';
      if (isReplace && update && !Array.isArray(update)) {
        // A replacement document keeps the tenant it already belongs to.
        if (update.tenantId && scope.kind === 'tenant' && !sameId(update.tenantId, scope.tenantId))
          throw new TenantContextError('tenantId cannot be changed');
        if (scope.kind === 'tenant') update.tenantId = scope.tenantId;
      } else if (update && touchesTenantId(update)) {
        throw new TenantContextError('tenantId cannot be changed');
      }
      if (scope.kind === 'platform') return;
      const filter = this.getFilter();
      if ('tenantId' in filter && !sameId(filter.tenantId, scope.tenantId)) {
        throw new TenantContextError('Query targets another tenant');
      }
      this.where({ tenantId: scope.tenantId });
    },
  );

  schema.pre('aggregate', function (this: any) {
    const scope = currentScope('aggregate', this._model?.modelName ?? 'unknown');
    if (scope.kind === 'platform') return;
    const pipeline: PipelineStage[] = this.pipeline();
    const first = pipeline[0] as Record<string, unknown> | undefined;
    const match = { $match: { tenantId: scope.tenantId } } as PipelineStage;
    // $geoNear/$search must stay first; filter right after them.
    if (first && ('$geoNear' in first || '$search' in first)) pipeline.splice(1, 0, match);
    else pipeline.unshift(match);
    if (
      pipeline.some(
        (s) => '$unionWith' in s || '$lookup' in s || '$graphLookup' in s || '$out' in s || '$merge' in s,
      )
    ) {
      throw new TenantContextError(
        'Cross-collection aggregation stages need withPlatformScope and an explicit review',
      );
    }
  });

  // Stamp before validation (validation runs ahead of 'save' hooks and requires tenantId).
  schema.pre('validate', function (this: any) {
    const scope = currentScope('validate', (this.constructor as { modelName: string }).modelName);
    if (this.isNew && !this.tenantId && scope.kind === 'tenant') this.tenantId = scope.tenantId;
    if (this.isNew && !this.tenantId)
      throw new TenantContextError('Platform-scoped create must set tenantId explicitly');
  });

  schema.pre('save', function (this: any) {
    const scope = currentScope('save', (this.constructor as { modelName: string }).modelName);
    if (scope.kind === 'platform') {
      if (!this.tenantId) throw new TenantContextError('Platform-scoped create must set tenantId explicitly');
      return;
    }
    if (this.isNew && !this.tenantId) this.tenantId = scope.tenantId;
    if (!sameId(this.tenantId, scope.tenantId))
      throw new TenantContextError('Document belongs to another tenant');
  });

  schema.pre('insertMany', function (this: any, ...args: unknown[]) {
    const scope = currentScope('insertMany', this.modelName);
    const docs = (Array.isArray(args[0]) ? args[0] : [args[0]]) as Record<string, unknown>[];
    for (const doc of docs) {
      if (scope.kind === 'platform') {
        if (!doc.tenantId)
          throw new TenantContextError('Platform-scoped insert must set tenantId explicitly');
        continue;
      }
      if (doc.tenantId && !sameId(doc.tenantId, scope.tenantId))
        throw new TenantContextError('Document belongs to another tenant');
      doc.tenantId = scope.tenantId;
    }
  });

  schema.pre('bulkWrite', function (this: any) {
    if (currentScope('bulkWrite', this.modelName).kind !== 'platform') {
      throw new TenantContextError('bulkWrite is not tenant-filtered; use per-document operations');
    }
  });

  schema.pre('estimatedDocumentCount', function (this: any) {
    if (currentScope('estimatedDocumentCount', this.model.modelName).kind !== 'platform') {
      throw new TenantContextError('estimatedDocumentCount ignores filters; use countDocuments');
    }
  });
}
