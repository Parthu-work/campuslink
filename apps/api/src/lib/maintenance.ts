import { TenantModel } from '../modules/tenants/tenant.model.js';
import { runInTenant } from './context.js';
import type { FilesService } from '../modules/files/files.service.js';
import type { PrivacyService } from '../modules/privacy/privacy.service.js';
import type { InsightsService } from '../modules/insights/insights.service.js';
import type { InactivityService } from '../modules/privacy/inactivity.service.js';
import { findTenantById } from '../modules/tenants/tenant.cache.js';
import type { Logger } from './logger.js';

/** Retention purge across tenants (idempotent; safe to run on every instance). */
export async function runRetention(
  files: FilesService,
  logger: Logger,
  privacy?: PrivacyService,
  insights?: InsightsService,
  inactivity?: InactivityService,
): Promise<void> {
  const tenants = await TenantModel.find({}).select('_id').lean();
  let warned = 0;
  let scheduled = 0;
  let purged = 0;
  let erased = 0;
  let rolled = 0;
  for (const t of tenants) {
    purged += await runInTenant(t._id, () => files.purgeExpired());
    // Accounts whose deletion grace period has ended (DPDP erasure).
    if (privacy) erased += await runInTenant(t._id, () => privacy.purgeDue());
    // Product events past 13 months become daily counts (B9).
    if (insights) rolled += await runInTenant(t._id, () => insights.rollupExpired());
    // Inactive accounts, where the college turned the purge on (prompt 1b, R7).
    if (inactivity) {
      const tenant = await findTenantById(t._id);
      if (tenant?.retention?.inactiveAccountMonths) {
        const r = await runInTenant(t._id, () => inactivity.run(tenant));
        warned += r.warned;
        scheduled += r.scheduled;
      }
    }
  }
  if (purged || erased || rolled || warned || scheduled)
    logger.info(
      { purged, erased, rolledDays: rolled, inactiveWarned: warned, inactiveScheduled: scheduled },
      'retention purge',
    );
}
