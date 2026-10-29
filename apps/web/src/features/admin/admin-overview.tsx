import type { ReactNode } from 'react';
import { useTranslation } from '../../i18n/react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BadgeCheck,
  BookOpenCheck,
  FileUp,
  Orbit,
  ShieldAlert,
  Sparkles,
  MessageCircle,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { AdminOverviewView, Count } from '@campuslink/shared';
import { IntentLink } from '../../components/ui/intent-link';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { ErrorState } from '../../components/ui/error-state';
import { adminOverview } from '../../lib/queries';
import { useNav } from '../../lib/nav';
import { ADMIN_ICONS } from '../../lib/admin-icons';
import { cn } from '../../lib/cn';
import { formatNumber } from '../../lib/numbers';

const shown = (c: Count | number) => (c === '<5' ? '<5' : formatNumber(c));

/** One queue: its size up front, what it is, and a tap into it. Waiting work is marked. */
function QueueCard({
  to,
  icon: Icon,
  title,
  value,
  waiting,
  children,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  value: ReactNode;
  waiting: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <IntentLink to={to} className="block h-full rounded-[var(--radius-lg)]">
      <Card variant="interactive" className="grid h-full content-start gap-2 p-4">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'grid size-9 flex-none place-items-center rounded-[var(--radius-md)]',
              waiting ? 'bg-brand-surface text-brand-ink' : 'bg-surface-2 text-fg-3',
            )}
            aria-hidden
          >
            <Icon className="size-5" />
          </span>
          <span className="min-w-0 flex-1 font-semibold">{title}</span>
          {waiting && <Badge tone="brand">{t('admin.ov.waiting')}</Badge>}
        </div>
        <p className="text-title font-semibold">{value}</p>
        {children && <p className="text-meta text-fg-2">{children}</p>}
      </Card>
    </IntentLink>
  );
}

/**
 * Admin › Overview (audit §7: a staff and admin home): what is waiting, with one tap into each
 * queue, then every section on phones (the side menu lists them on desktop). Only what this
 * member may act on is shown; member and activity counts under 5 show as "<5".
 */
export function AdminOverview() {
  const { t } = useTranslation();
  const { admin } = useNav();
  const q = useQuery(adminOverview());
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const v: AdminOverviewView | undefined = q.data;
  return (
    <div className="grid gap-6">
      <section aria-labelledby="ov-queues" className="grid gap-3">
        <h2 id="ov-queues" className="text-title font-semibold">
          {t('admin.ov.title')}
        </h2>
        {!v ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 rounded-[var(--radius-lg)]" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {v.onboarding && (
              <QueueCard
                to="/admin/onboarding"
                icon={UserPlus}
                title={t('admin.ov.onboarding')}
                value={shown(v.onboarding.notJoined)}
                waiting={v.onboarding.notJoined > 0}
              >
                {t('admin.ov.onboardingHint', { count: v.onboarding.notJoined })}
              </QueueCard>
            )}
            {v.verification && (
              <QueueCard
                to="/admin/verification"
                icon={BadgeCheck}
                title={t('admin.ov.verification')}
                value={shown(v.verification.pending)}
                waiting={v.verification.pending > 0}
              >
                {t('admin.ov.verificationHint')}
              </QueueCard>
            )}
            {v.moderation && (
              <QueueCard
                to="/admin/moderation"
                icon={ShieldAlert}
                title={t('admin.ov.moderation')}
                value={shown(
                  v.moderation.reports +
                    v.moderation.pendingQuestions +
                    v.moderation.appeals +
                    v.moderation.heldItems,
                )}
                waiting={
                  v.moderation.reports +
                    v.moderation.pendingQuestions +
                    v.moderation.appeals +
                    v.moderation.heldItems >
                  0
                }
              >
                {t('admin.ov.moderationHint', {
                  reports: v.moderation.reports,
                  questions: v.moderation.pendingQuestions,
                  appeals: v.moderation.appeals,
                  held: v.moderation.heldItems,
                })}
              </QueueCard>
            )}
            {v.roadmapReviews && (
              <QueueCard
                to="/roadmaps/review"
                icon={Orbit}
                title={t('admin.ov.roadmaps')}
                value={shown(v.roadmapReviews.pending)}
                waiting={v.roadmapReviews.pending > 0}
              >
                {t('admin.ov.roadmapsHint')}
              </QueueCard>
            )}
            {v.materialReviews && (
              <QueueCard
                to="/study"
                icon={BookOpenCheck}
                title={t('admin.ov.material')}
                value={shown(v.materialReviews.pending)}
                waiting={v.materialReviews.pending > 0}
              >
                {t('admin.ov.materialHint')}
              </QueueCard>
            )}
            {v.imports && (
              <QueueCard
                to="/admin/imports"
                icon={FileUp}
                title={t('admin.ov.imports')}
                value={shown(v.imports.running)}
                waiting={v.imports.failedThisWeek > 0}
              >
                {t('admin.ov.importsHint', { failed: v.imports.failedThisWeek })}
              </QueueCard>
            )}
            {v.members && (
              <QueueCard
                to="/admin/users"
                icon={Users}
                title={t('admin.ov.members')}
                value={shown(v.members.active)}
                waiting={false}
              >
                {t('admin.ov.membersHint', {
                  unverified: shown(v.members.unverified),
                  suspended: shown(v.members.suspended),
                })}
              </QueueCard>
            )}
            {v.activity && (
              <QueueCard
                to="/admin/analytics"
                icon={Activity}
                title={t('admin.ov.activity')}
                value={shown(v.activity.last7)}
                waiting={false}
              >
                {t('admin.ov.activityHint', { last30: shown(v.activity.last30) })}
              </QueueCard>
            )}
            {v.ai && (
              <QueueCard
                to="/admin/ai"
                icon={Sparkles}
                title={t('admin.ov.ai')}
                value={
                  v.ai.status.answers
                    ? v.ai.status.demo
                      ? t('ai.onDemo')
                      : t('ai.on')
                    : t(`ai.reason.${v.ai.status.reason ?? 'not_configured'}`)
                }
                waiting={v.ai.status.reason === 'key_invalid' || (v.ai.budgetPercent ?? 0) >= 80}
              >
                {v.ai.budgetPercent === null
                  ? t('admin.ov.aiNoBudget')
                  : t('admin.ov.aiBudget', { percent: v.ai.budgetPercent })}
              </QueueCard>
            )}
            {v.whatsapp && (
              <QueueCard
                to="/admin/features"
                icon={MessageCircle}
                title={t('admin.ov.whatsapp')}
                value={String(v.whatsapp.sent)}
                waiting={v.whatsapp.allowance > 0 && v.whatsapp.sent >= v.whatsapp.allowance * 0.8}
              >
                {t('admin.ov.whatsappHint', { allowance: v.whatsapp.allowance })}
              </QueueCard>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="ov-sections" className="grid gap-4 lg:hidden">
        <h2 id="ov-sections" className="text-title font-semibold">
          {t('admin.ov.sections')}
        </h2>
        {admin.map((g) => (
          <div key={g.group} className="grid gap-2">
            <p className="eyebrow text-fg-3">{g.label}</p>
            <ul className="grid overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface-1">
              {g.items.map((i) => {
                const Icon = ADMIN_ICONS[i.id];
                return (
                  <li key={i.id} className="border-b border-line last:border-b-0">
                    <IntentLink
                      to={i.to}
                      className="flex min-h-12 items-center gap-3 px-4 font-semibold hover:bg-surface-2"
                    >
                      <Icon className="size-5 text-brand-ink" aria-hidden />
                      {i.label}
                    </IntentLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
