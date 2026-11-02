import mongoose, { type Model, type Schema } from 'mongoose';
import { tenantPlugin, TENANT_PLUGIN_MARK } from './tenant-plugin.js';

/**
 * All models are created through these two helpers (lint bans mongoose.model elsewhere).
 * Tenant-owned is the default; platform models are an explicit, short allowlist.
 */
export const PLATFORM_MODELS = new Set([
  'Tenant',
  'Migration',
  'WebhookReceipt',
  // Billing (B10): the seller's plan settings and its invoice number sequence.
  'PlanSetting',
  'InvoiceCounter',
]);

export function defineTenantModel<T>(name: string, schema: Schema<T>): Model<T> {
  schema.plugin(tenantPlugin);
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema);
}

export function definePlatformModel<T>(name: string, schema: Schema<T>): Model<T> {
  if (!PLATFORM_MODELS.has(name)) throw new Error(`${name} is not on the platform model allowlist`);
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema);
}

export function isTenantScoped(model: Model<unknown>): boolean {
  return (model.schema as unknown as Record<symbol, boolean>)[TENANT_PLUGIN_MARK] === true;
}

/** Shared schema options: strict, timestamps, no version key leaks in JSON. */
export const baseSchemaOptions = {
  strict: 'throw' as const,
  strictQuery: true,
  timestamps: true,
  toJSON: { virtuals: false, versionKey: false },
};
