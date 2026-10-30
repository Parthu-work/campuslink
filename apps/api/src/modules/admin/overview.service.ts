import { ADMIN_PERMISSIONS, suppress, type AdminOverviewView, type Permission } from '@campuslink/shared';
import { forbidden } from '../../lib/errors.js';
import type { AuthState } from '../../types.js';
import type { UsersService } from '../users/users.service.js';
import type { VerificationService } from '../verification/verification.service.js';
import type { SafetyService } from '../moderation/safety.service.js';
import type { ModerationService } from '../moderation/moderation.service.js';
import type { QaService } from '../qa/qa.service.js';
import type { ContentSourcesService } from '../content-sources/sources.service.js';
import type { RoadmapsService } from '../roadmaps/roadmaps.service.js';
import type { MaterialsService } from '../study/materials.service.js';
import type { ImportsService } from '../imports/imports.service.js';
import type { AnalyticsService } from '../analytics/analytics.service.js';
import type { AiSettingsService } from '../study/ai-settings.service.js';
import type { AiUsageService } from '../study/ai-usage.service.js';
import { featureEnabled } from '../tenants/features.js';
import type { ChannelService } from '../notifications/channels/channel.service.js';
import type { OnboardingService } from '../verification/onboarding.service.js';
import type { PlacementsService } from '../placements/placements.service.js';
import type { OffersService } from '../placements/offers.service.js';
import type { OutcomesService } from '../placements/outcomes.service.js';

export interface OverviewDeps {
  users: UsersService;
  verification: VerificationService;
  safety: SafetyService;
  moderation: ModerationService;
  qa: QaService;
  sources: ContentSourcesService;
  roadmaps: RoadmapsService;
  materials: MaterialsService;
  imports: ImportsService;
  analytics: AnalyticsService;
  ai: AiSettingsService;
  channels?: ChannelService;
  onboarding?: OnboardingService;
  placements?: PlacementsService;
  offers?: OffersService;
  outcomes?: OutcomesService;
  usage: AiUsageService;
}

/**
 * Admin › Overview (audit §7: staff and admin home): what is waiting for this member, from the
 * services that own each queue. A part is computed only when the member holds its permission.
 */
export class AdminOverviewService {
  constructor(private readonly d: OverviewDeps) {}

  async overview(viewer: AuthState): Promise<AdminOverviewView> {
    const can = (p: Permission) => viewer.permissions.has(p);
    if (!ADMIN_PERMISSIONS.some(can)) throw forbidden();
    const when = <T>(ok: boolean, fn: () => Promise<T>) => (ok ? fn() : Promise.resolve(null));
    // Study queues stay out of the overview while the college has Study off (B1).
    const study = await featureEnabled('study');
    const [members, activity, verification, moderation, roadmapReviews, materialReviews, imports, ai] =
      await Promise.all([
        when(can('users:read_admin'), async () => {
          const c = await this.d.users.memberCounts();
          return {
            active: suppress(c.active),
            unverified: suppress(c.unverified),
            suspended: suppress(c.suspended),
          };
        }),
        when(can('analytics:tenant'), () => this.d.analytics.activity()),
        when(can('verification:review'), async () => ({ pending: await this.d.verification.pendingCount() })),
        when(can('moderation:act'), async () => ({
          reports: await this.d.safety.openReportCount(),
          pendingQuestions: await this.d.qa.pendingCount(),
          appeals: await this.d.moderation.openAppealCount(),
          heldItems: await this.d.sources.heldCount(),
        })),
        when(can('roadmaps:review'), async () => ({ pending: await this.d.roadmaps.reviewCount() })),
        when(study && can('study:manage'), async () => ({
          pending: await this.d.materials.reviewCount(viewer),
        })),
        when(can('imports:manage'), () => this.d.imports.activityCounts()),
        when(study && can('ai:settings'), async () => {
          const rt = await this.d.ai.runtime();
          const limit = rt.settings.monthlyTokenBudget;
          const used = limit > 0 ? await this.d.usage.monthTokens() : 0;
          return {
            status: rt.status,
            budgetPercent: limit > 0 ? Math.min(999, Math.round((used / limit) * 100)) : null,
          };
        }),
      ]);
    const whatsapp =
      this.d.channels && can('tenant:settings') && (await featureEnabled('whatsapp'))
        ? await this.d.channels.usage().then((u) => ({ sent: u.sent, allowance: u.allowance }))
        : null;
    const onboarding =
      this.d.onboarding && can('onboarding:manage')
        ? { notJoined: await this.d.onboarding.notJoined() }
        : null;
    // B7: drives closing in 48 hours and offers waiting for verification (switched off: none).
    const placementsOn = await featureEnabled('placements');
    const placements =
      placementsOn && this.d.placements && can('placements:manage')
        ? { closingSoon: await this.d.placements.closingSoon() }
        : null;
    const offers =
      placementsOn && this.d.offers && can('outcomes:verify')
        ? {
            // B8: higher studies, exams and ventures wait in the same queue.
            pending: (await this.d.offers.pendingCount()) + ((await this.d.outcomes?.pendingCount()) ?? 0),
          }
        : null;
    return {
      onboarding,
      placements,
      offers,
      members,
      activity,
      verification,
      moderation,
      roadmapReviews,
      materialReviews,
      imports,
      ai,
      whatsapp,
    };
  }
}
