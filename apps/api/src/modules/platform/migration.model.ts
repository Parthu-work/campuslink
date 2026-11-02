import { Schema, type InferSchemaType } from 'mongoose';
import { definePlatformModel, baseSchemaOptions } from '../../db/models.js';

/**
 * One row per data migration that has run (db/migrations.ts). The unique name is the lock: the
 * first process to insert it runs the migration; a failed run removes its row so it runs again.
 */
const migrationSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    /** Documents the migration changed (for the log). */
    changed: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);

export type MigrationDoc = InferSchemaType<typeof migrationSchema>;
export const MigrationModel = definePlatformModel('Migration', migrationSchema);
