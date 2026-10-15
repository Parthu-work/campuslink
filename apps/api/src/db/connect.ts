import mongoose from 'mongoose';
import { withPlatformScope } from '../lib/context.js';
import '../modules/models.js';

mongoose.set('strictQuery', true);
// NoSQL-injection defence is at the edge: strict Zod schemas accept only primitives, and
// middleware/no-operators.ts rejects `$`/dotted keys before any handler runs (ADR 0006).
mongoose.set('autoIndex', false);

/** Indexes are created explicitly at boot (and in tests), never lazily on first query. */
export async function syncIndexes(): Promise<void> {
  await withPlatformScope('platform:sync-indexes', async () => {
    for (const model of Object.values(mongoose.models)) await model.syncIndexes();
  });
}
