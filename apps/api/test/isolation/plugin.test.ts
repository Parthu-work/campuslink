/**
 * MANDATORY tenant-isolation suite (database layer). Blocks CI.
 * Exercises the tenant plugin directly with every read/write path Mongoose offers.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import mongoose, { Schema, Types } from 'mongoose';
import { runInTenant, withPlatformScope, TenantContextError } from '../../src/lib/context.js';
import { defineTenantModel, isTenantScoped, PLATFORM_MODELS } from '../../src/db/models.js';
import '../../src/modules/models.js';
import { withTextSearch } from '../../src/db/search.js';

const noteSchema = new Schema({ title: String, body: String, n: Number }, { strict: 'throw' });
noteSchema.index({ tenantId: 1, title: 'text', body: 'text' });
const Note = defineTenantModel('IsolationNote', noteSchema);

const A = new Types.ObjectId();
const B = new Types.ObjectId();
let aNoteId: Types.ObjectId;
let bNoteId: Types.ObjectId;

beforeAll(async () => {
  await withPlatformScope('test:sync-indexes', () => Note.syncIndexes());
  aNoteId = (
    await runInTenant(A, () => Note.create({ title: 'placement secrets alpha', body: 'tenant A only', n: 1 }))
  )._id;
  bNoteId = (
    await runInTenant(B, () => Note.create({ title: 'placement secrets beta', body: 'tenant B only', n: 1 }))
  )._id;
  await runInTenant(A, () =>
    Note.insertMany([
      { title: 'a2', n: 2 },
      { title: 'a3', n: 3 },
    ]),
  );
});

describe('no context → no database access', () => {
  it.each([
    ['find', () => Note.find({}).lean()],
    ['findOne', () => Note.findOne({}).lean()],
    ['findById', () => Note.findById(aNoteId).lean()],
    ['countDocuments', () => Note.countDocuments({})],
    ['updateMany', () => Note.updateMany({}, { $set: { n: 9 } })],
    ['deleteMany', () => Note.deleteMany({})],
    ['aggregate', () => Note.aggregate([{ $match: {} }])],
    ['create', () => Note.create({ title: 'x' })],
    ['insertMany', () => Note.insertMany([{ title: 'x' }])],
    ['distinct', () => Note.distinct('title')],
  ])('%s throws without tenant context', async (_name, op) => {
    await expect(op()).rejects.toBeInstanceOf(TenantContextError);
  });
});

describe('reads are scoped', () => {
  it('find only returns the current tenant’s documents', async () => {
    const titles = await runInTenant(A, () => Note.find({}).lean());
    expect(titles.every((n) => String(n.tenantId) === String(A))).toBe(true);
    expect(titles).toHaveLength(3);
  });
  it('findById of another tenant’s document returns null', async () => {
    expect(await runInTenant(A, () => Note.findById(bNoteId).lean())).toBeNull();
  });
  it('an explicit filter for another tenant throws', async () => {
    await expect(runInTenant(A, () => Note.find({ tenantId: B }).lean())).rejects.toThrow(/another tenant/);
  });
  it('$or cannot escape the tenant filter', async () => {
    const r = await runInTenant(A, () => Note.find({ $or: [{ _id: bNoteId }, { title: 'zzz' }] }).lean());
    expect(r).toHaveLength(0);
  });
  it('countDocuments and distinct are scoped', async () => {
    expect(await runInTenant(B, () => Note.countDocuments({}))).toBe(1);
    expect(await runInTenant(B, () => Note.distinct('title'))).toEqual(['placement secrets beta']);
  });
  it('estimatedDocumentCount is refused (it cannot be filtered)', async () => {
    await expect(runInTenant(A, () => Note.estimatedDocumentCount())).rejects.toThrow(/countDocuments/);
  });
  it('aggregate is prefixed with a tenant $match', async () => {
    const r = await runInTenant(A, () =>
      Note.aggregate<{ total: number }>([{ $group: { _id: null, total: { $sum: '$n' } } }]),
    );
    expect(r[0]?.total).toBe(6);
  });
  it('aggregate cross-collection stages are refused', async () => {
    await expect(
      runInTenant(A, () =>
        Note.aggregate([{ $lookup: { from: 'users', localField: 'x', foreignField: '_id', as: 'u' } }]),
      ),
    ).rejects.toThrow(/Cross-collection/);
    await expect(runInTenant(A, () => Note.aggregate([{ $unionWith: 'isolationnotes' }]))).rejects.toThrow(
      /Cross-collection/,
    );
  });
  it('text search only matches the current tenant', async () => {
    const r = await runInTenant(A, () => withTextSearch(Note.find({}), 'placement secrets').lean());
    expect(r.map((n) => n.title)).toEqual(['placement secrets alpha']);
  });
});

describe('writes are scoped', () => {
  it('create stamps the current tenant', async () => {
    const n = await runInTenant(B, () => Note.create({ title: 'stamped' }));
    expect(String(n.tenantId)).toBe(String(B));
  });
  it('create with another tenant’s id throws', async () => {
    await expect(runInTenant(A, () => Note.create({ title: 'x', tenantId: B }))).rejects.toThrow(
      /another tenant/,
    );
  });
  it('insertMany with another tenant’s id throws', async () => {
    await expect(runInTenant(A, () => Note.insertMany([{ title: 'x', tenantId: B }]))).rejects.toThrow(
      /another tenant/,
    );
  });
  it('updateOne by id cannot touch another tenant’s document', async () => {
    const r = await runInTenant(A, () => Note.updateOne({ _id: bNoteId }, { $set: { body: 'pwned' } }));
    expect(r.matchedCount).toBe(0);
    expect((await runInTenant(B, () => Note.findById(bNoteId).lean()))?.body).toBe('tenant B only');
  });
  it('updateMany({}) only touches the current tenant', async () => {
    await runInTenant(A, () => Note.updateMany({}, { $inc: { n: 0 } }));
    const r = await runInTenant(A, () => Note.updateMany({}, { $set: { body: 'bulk' } }));
    expect(r.matchedCount).toBe(3);
    expect((await runInTenant(B, () => Note.findById(bNoteId).lean()))?.body).toBe('tenant B only');
  });
  it('findOneAndUpdate cannot reach another tenant', async () => {
    expect(
      await runInTenant(A, () =>
        Note.findOneAndUpdate({ _id: bNoteId }, { $set: { n: 99 } }, { new: true }).lean(),
      ),
    ).toBeNull();
  });
  it('replaceOne cannot reach another tenant', async () => {
    const r = await runInTenant(A, () => Note.replaceOne({ _id: bNoteId }, { title: 'replaced' }));
    expect(r.matchedCount).toBe(0);
    await expect(
      runInTenant(A, () => Note.replaceOne({ _id: aNoteId }, { title: 'moved', tenantId: B })),
    ).rejects.toThrow(/cannot be changed/);
    await runInTenant(A, () =>
      Note.replaceOne({ _id: aNoteId }, { title: 'placement secrets alpha', body: 'tenant A only', n: 1 }),
    );
    expect(String((await runInTenant(A, () => Note.findById(aNoteId).lean()))?.tenantId)).toBe(String(A));
  });
  it('tenantId cannot be changed by update', async () => {
    await expect(
      runInTenant(A, () => Note.updateOne({ _id: aNoteId }, { $set: { tenantId: B } })),
    ).rejects.toThrow(/cannot be changed/);
    // Pipeline updates are refused outright (by Mongoose, and by the plugin if ever enabled).
    await expect(
      runInTenant(A, () => Note.updateOne({ _id: aNoteId }, [{ $set: { tenantId: B } }])),
    ).rejects.toThrow();
  });
  it('saving a document loaded in another tenant throws', async () => {
    const doc = await runInTenant(B, () => Note.findById(bNoteId));
    doc!.body = 'cross-save';
    await expect(runInTenant(A, () => doc!.save())).rejects.toThrow(/another tenant/);
  });
  it('bulkWrite is refused in tenant context', async () => {
    await expect(runInTenant(A, () => Note.bulkWrite([{ deleteMany: { filter: {} } }]))).rejects.toThrow(
      /bulkWrite/,
    );
  });
});

describe('deletes are scoped', () => {
  it('deleteOne / findOneAndDelete / deleteMany cannot remove another tenant’s data', async () => {
    expect((await runInTenant(A, () => Note.deleteOne({ _id: bNoteId }))).deletedCount).toBe(0);
    expect(await runInTenant(A, () => Note.findOneAndDelete({ _id: bNoteId }).lean())).toBeNull();
    await runInTenant(A, () => Note.deleteMany({ title: /placement/ }));
    expect(await runInTenant(B, () => Note.findById(bNoteId).lean())).not.toBeNull();
  });
  it('document.deleteOne() is scoped to its tenant', async () => {
    const doc = await runInTenant(B, () => Note.findById(bNoteId));
    await expect(runInTenant(A, async () => (await doc!.deleteOne()).deletedCount)).resolves.toBe(0);
  });
});

describe('platform scope', () => {
  it('requires a named reason', () => {
    expect(() => withPlatformScope('anything goes', () => 1)).toThrow(/Invalid platform scope reason/);
  });
  it('can read across tenants but must stamp tenantId on create', async () => {
    expect(await withPlatformScope('test:cross-read', () => Note.countDocuments({}))).toBeGreaterThan(1);
    await expect(withPlatformScope('test:create', () => Note.create({ title: 'orphan' }))).rejects.toThrow(
      /explicitly/,
    );
  });
});

describe('model registry guard', () => {
  it('every registered model is tenant-scoped unless explicitly allowlisted as platform', () => {
    for (const [name, model] of Object.entries(mongoose.models)) {
      if (PLATFORM_MODELS.has(name)) expect(isTenantScoped(model), name).toBe(false);
      else expect(isTenantScoped(model), `${name} must use defineTenantModel`).toBe(true);
    }
  });
  it('every tenant-scoped index leads with tenantId (TTL indexes excepted)', () => {
    for (const model of Object.values(mongoose.models)) {
      if (!isTenantScoped(model)) continue;
      for (const [fields, opts] of model.schema.indexes()) {
        if ((opts as { expireAfterSeconds?: number }).expireAfterSeconds !== undefined) continue;
        expect(Object.keys(fields)[0], `${model.modelName} index ${JSON.stringify(fields)}`).toBe('tenantId');
      }
    }
  });
});
