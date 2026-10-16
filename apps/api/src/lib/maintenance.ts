import { TenantModel } from '../modules/tenants/tenant.model.js';
import { runInTenant } from './context.js';
import type { FilesService } from '../modules/files/files.service.js';
import type { PrivacyService } from '../modules/privacy/privacy.service.js';
import type { Logger } from './logger.js';

/** Retention purge across tenants (idempotent; safe to run on every instance). */
export async function runRetention(
  files: FilesService,
  logger: Logger,
  privacy?: PrivacyService,
): Promise<void> {
  const tenants = await TenantModel.find({}).select('_id').lean();
  let purged = 0;
  let erased = 0;
  for (const t of tenants) {
    purged += await runInTenant(t._id, () => files.purgeExpired());
    // Accounts whose deletion grace period has ended (DPDP erasure).
    if (privacy) erased += await runInTenant(t._id, () => privacy.purgeDue());
  }
  if (purged || erased) logger.info({ purged, erased }, 'retention purge');
}
