import { TenantModel } from '../modules/tenants/tenant.model.js';
import { runInTenant } from './context.js';
import type { FilesService } from '../modules/files/files.service.js';
import type { Logger } from './logger.js';

/** Retention purge across tenants (idempotent; safe to run on every instance). */
export async function runRetention(files: FilesService, logger: Logger): Promise<void> {
  const tenants = await TenantModel.find({}).select('_id').lean();
  let purged = 0;
  for (const t of tenants) purged += await runInTenant(t._id, () => files.purgeExpired());
  if (purged) logger.info({ purged }, 'retention purge');
}
