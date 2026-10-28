import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { Award, Download, Flame, Gift, Lock, Medal, Sparkles, Trophy, Users } from 'lucide-react';
import { BADGES, type MyProgressView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Checkbox } from '../../components/ui/field';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { ProgressRing } from '../../components/ui/progress';
import { api, ApiError, saveBlob } from '../../lib/api';
import { progress } from '../../lib/queries';
import { useCan, useMe } from '../../lib/me';
import { useTenant } from '../../lib/tenant-context';
import { formatRelative, formatWeekday, localDateKey } from '../../lib/format';
import { celebrate, firstSighting } from '../../lib/celebrate';
import { drawImpactCard } from '../../lib/impact-card';
import { cn } from '../../lib/cn';
import { SCREEN } from '../../lib/query-client';

function ImpactCardButton({ p }: { p: MyProgressView }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const tenant = useTenant();
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const blob = await drawImpactCard({
        name: me?.name ?? '',
        college: tenant?.branding.displayName ?? '',
        headline: t('progress.card.headline', { count: p.menteesHelped }),
        detail: t('progress.card.detail', { count: p.sessionsMentored }),
        level: p.mentorLevel ? t(`progress.mentorLevels.${p.mentorLevel}`) : null,
      });
      saveBlob(blob, 'impact-card.png');
    } catch {
      toast.error(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" loading={busy} onClick={() => void make()} disabled={!p.menteesHelped}>
      <Download className="size-4" aria-hidden /> {t('progress.card.download')}
    </Button>
  );
}

/**
 * The streak and the last seven days: a day is lit when it earned XP (from the recent activity
 * the API returns), today last.
 */
function WeekStrip({ streak, recent }: { streak: number; recent: MyProgressView['recent'] }) {
  const { t } = useTranslation();
  const active = new Set(recent.filter((e) => e.points > 0).map((e) => localDateKey(e.createdAt)));
  const [today] = useState(() => Date.now());
  const days = Array.from({ length: 7 }, (_, i) => new Date(today - (6 - i) * 86_400_000));
  const lit = days.filter((d) => active.has(localDateKey(d))).length;
  return (
    <div className="grid gap-2">
      <p className="flex items-center gap-2">
        <Flame className={cn('size-6', streak > 0 ? 'text-warning' : 'text-fg-3')} aria-hidden />
        <b className="text-lead">{t('progress.days', { count: streak })}</b>
        <span className="text-meta text-fg-2">{t('progress.streak')}</span>
      </p>
      <ol aria-label={t('progress.weekLabel', { n: lit })} className="flex gap-1.5">
        {days.map((d) => {
          const on = active.has(localDateKey(d));
          return (
            <li key={d.toISOString()} className="grid flex-1 justify-items-center gap-1" aria-hidden>
              <span className={cn('h-2 w-full max-w-10 rounded-full', on ? 'bg-aurora' : 'bg-surface-3')} />
              <span className="text-caption text-fg-3">{formatWeekday(d)}</span>
            </li>
          );
        })}
      </ol>
      <p className="text-caption text-fg-3">{t('progress.streakHint')}</p>
    </div>
  );
}

export function ProgressPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canMentor = useCan('mentorship:mentor');
  const q = useQuery({ ...progress(), ...SCREEN });
  // A badge earned in the last few days is celebrated the first time this device sees it (§6).
  useEffect(() => {
    const fresh = (q.data?.badges ?? [])
      .filter((b) => Date.now() - Date.parse(b.awardedAt) < 3 * 86_400_000)
      .map((b) => b.id);
    if (fresh.length && firstSighting('badges', fresh)) celebrate();
  }, [q.data]);
  const prefs = useMutation({
    mutationFn: (v: MyProgressView['prefs']) => api.put<MyProgressView['prefs']>('/me/progress/settings', v),
    onSuccess: (prefs) => {
      qc.setQueryData<MyProgressView>(['progress'], (old) => (old ? { ...old, prefs } : old));
      void qc.invalidateQueries({ queryKey: ['leaderboard'] });
      void qc.invalidateQueries({ queryKey: ['wall'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  if (q.isLoading || !q.data)
    return (
      <div className="grid gap-3" aria-hidden>
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40" />
      </div>
    );
  const p = q.data;
  const span = p.level.next - p.level.current;
  const pct = span ? Math.round(((p.xp - p.level.current) / span) * 100) : 0;
  const earned = new Map(p.badges.map((b) => [b.id, b.awardedAt]));
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={<Trophy />}
        title={t('progress.title')}
        intro={t('progress.intro')}
        actions={
          <>
            <Link to="/leaderboard" className={buttonVariants({ size: 'sm' })}>
              <Medal className="size-4" aria-hidden /> {t('progress.leaderboard')}
            </Link>
            <Link to="/rewards" className={buttonVariants({ size: 'sm', variant: 'primary' })}>
              <Gift className="size-4" aria-hidden /> {t('progress.rewards')}
            </Link>
          </>
        }
      />

      {/* The hero: XP as an aurora ring and the streak with its week (§8.10). */}
      <Card
        variant="featured"
        className="grid gap-5 p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:p-6"
      >
        <ProgressRing
          value={pct}
          max={100}
          size={136}
          stroke={11}
          tone="aurora"
          label={t('progress.toNextLevel')}
          valueText={`${pct}%`}
          className="justify-self-center"
        >
          <span className="grid justify-items-center">
            <span className="text-caption font-semibold text-fg-2">{t('progress.level')}</span>
            <b className="font-display text-display leading-none tabular-nums">{p.level.level}</b>
          </span>
        </ProgressRing>
        <div className="grid gap-4">
          <div>
            <h2 className="text-title font-bold">{t('progress.levelN', { level: p.level.level })}</h2>
            <p className="text-meta text-fg-2 tabular-nums">
              {t('progress.xpToNext', { xp: p.xp, next: p.level.next })}
            </p>
          </div>
          <WeekStrip streak={p.streak} recent={p.recent} />
        </div>
      </Card>

      <StatGrid className="md:grid-cols-3">
        <StatCard
          icon={<Sparkles className="size-4" aria-hidden />}
          label={t('progress.xp')}
          value={String(p.xp)}
        />
        <StatCard
          icon={<Gift className="size-4" aria-hidden />}
          label={t('progress.balance')}
          value={String(p.balance.xp)}
        />
        <StatCard
          icon={<Award className="size-4" aria-hidden />}
          label={t('progress.badges')}
          value={`${p.badges.length}/${BADGES.length}`}
        />
      </StatGrid>

      {(canMentor || p.impact > 0) && (
        <section aria-labelledby="impact" className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="impact" className="text-title font-semibold">
              {t('progress.impactTitle')}
            </h2>
            <div className="flex flex-wrap gap-2">
              <Link to="/wall-of-mentors" className={buttonVariants({ size: 'sm' })}>
                <Users className="size-4" aria-hidden /> {t('progress.wall')}
              </Link>
              <ImpactCardButton p={p} />
            </div>
          </div>
          <StatGrid>
            <StatCard
              icon={<Sparkles className="size-4" aria-hidden />}
              label={t('progress.impact')}
              value={String(p.impact)}
            />
            <StatCard
              icon={<Medal className="size-4" aria-hidden />}
              label={t('progress.mentorLevel')}
              value={p.mentorLevel ? t(`progress.mentorLevels.${p.mentorLevel}`) : '—'}
              hint={t('progress.mentorLevelHint')}
            />
            <StatCard
              icon={<Users className="size-4" aria-hidden />}
              label={t('progress.mentees')}
              value={String(p.menteesHelped)}
            />
            <StatCard
              icon={<Award className="size-4" aria-hidden />}
              label={t('progress.sessions')}
              value={String(p.sessionsMentored)}
            />
          </StatGrid>
        </section>
      )}

      <section aria-labelledby="badges" className="grid gap-2">
        <h2 id="badges" className="flex items-baseline gap-2 text-title font-semibold">
          {t('progress.badges')}
          <span className="text-meta font-normal text-fg-2 tabular-nums">
            {t('progress.badgeCount', { n: p.badges.length, total: BADGES.length })}
          </span>
        </h2>
        {/* A collection: earned badges in aurora, locked ones as silhouettes with how to earn them. */}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {BADGES.map((b) => {
            const at = earned.get(b);
            return (
              <li key={b}>
                <Card
                  variant={at ? 'raised' : 'flat'}
                  className={cn(
                    'grid h-full justify-items-center gap-2 p-4 text-center',
                    !at && 'border-dashed bg-transparent',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-16 place-items-center rounded-full',
                      at ? 'aurora-ring p-[3px]' : 'border-2 border-dashed border-line-strong text-fg-3',
                    )}
                  >
                    {at ? (
                      <span className="grid size-full place-items-center rounded-full bg-surface-1 text-brand-ink">
                        <Award className="size-7" aria-hidden />
                      </span>
                    ) : (
                      <Lock className="size-6" aria-hidden />
                    )}
                  </span>
                  <span className={cn('text-body font-semibold', !at && 'text-fg-2')}>
                    {t(`progress.badge.${b}.name`)}
                  </span>
                  <span className="text-meta text-fg-2">{t(`progress.badge.${b}.description`)}</span>
                  <span className={cn('text-caption', at ? 'font-semibold text-brand-ink' : 'text-fg-3')}>
                    {at ? t('progress.earned', { when: formatRelative(at) }) : t('progress.locked')}
                  </span>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="recent" className="grid content-start gap-2">
          <h2 id="recent" className="text-title font-semibold">
            {t('progress.recent')}
          </h2>
          {p.recent.length ? (
            <ul className="grid gap-1.5">
              {p.recent.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-surface-1 px-3.5 py-2.5 text-meta"
                >
                  <span>
                    {t(`progress.kind.${e.kind}`)}
                    {e.note && <span className="text-fg-3"> · {e.note}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={e.points >= 0 ? 'success' : 'neutral'}>
                      {e.points > 0 ? '+' : ''}
                      {e.points} {t(`progress.track.${e.track}`)}
                    </Badge>
                    <span className="text-caption text-fg-3">{formatRelative(e.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-meta text-fg-2">{t('progress.nothingYet')}</p>
          )}
        </section>
        <section aria-labelledby="privacy" className="grid content-start gap-2">
          <h2 id="privacy" className="text-title font-semibold">
            {t('progress.privacy')}
          </h2>
          <Card className="grid gap-3 p-4">
            <Checkbox
              id="opt-leaderboard"
              checked={p.prefs.showOnLeaderboard}
              onChange={(v) => prefs.mutate({ ...p.prefs, showOnLeaderboard: v })}
            >
              {t('progress.optLeaderboard')}
            </Checkbox>
            {(canMentor || p.impact > 0) && (
              <Checkbox
                id="opt-wall"
                checked={p.prefs.showOnWall}
                onChange={(v) => prefs.mutate({ ...p.prefs, showOnWall: v })}
              >
                {t('progress.optWall')}
              </Checkbox>
            )}
            <p className="text-caption text-fg-3">{t('progress.privacyHint')}</p>
          </Card>
          <h3 className="mt-2 text-meta font-semibold">{t('progress.howTitle')}</h3>
          <p className="text-meta text-fg-2">{t('progress.how')}</p>
        </section>
      </div>
    </div>
  );
}
