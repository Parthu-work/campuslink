import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll } from 'vitest';
import { syncIndexes } from '../src/db/connect.js';
import { clearTenantCache } from '../src/modules/tenants/tenant.cache.js';

/** Each test file gets its own throwaway database on the local (or CI) MongoDB. */
const base = process.env.MONGODB_URI_TEST ?? 'mongodb://127.0.0.1:27017/?directConnection=true';
const dbName = `campuslink_test_${randomBytes(4).toString('hex')}`;

beforeAll(async () => {
  await mongoose.connect(base, { dbName, serverSelectionTimeoutMS: 4000 });
  await syncIndexes();
  clearTenantCache();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
});
