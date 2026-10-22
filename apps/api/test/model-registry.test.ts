import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import * as registry from '../src/modules/models.js';
import '../src/app.js';

describe('model registry', () => {
  it('every model the app defines is registered (index sync and the tenancy tests see it)', () => {
    const registered = new Set(Object.values(registry).map((m) => m.modelName));
    expect(mongoose.modelNames().filter((n) => !registered.has(n))).toEqual([]);
  });
});
