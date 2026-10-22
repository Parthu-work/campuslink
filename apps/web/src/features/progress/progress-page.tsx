import { useState } from 'react';
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
import { api, ApiError, saveBlob } from '../../lib/api';
import { progress } from '../../lib/queries';
import { useCan, useMe } from '../../lib/me';
import { useTenant } from '../../lib/tenant-context';
import { formatRelative } from '../../lib/format';
import { drawImpactCard } from '../../lib/impact-card';
import { cn } from '../../lib/cn';

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="grid gap-1 p-4">
      <span className="flex items-center gap-2 text-sm text-fg-2">
        {icon} {label}
      </span>
      <span className="font-display text-3xl font-bold">{value}</span>
      {hint && <span className="text-xs text-fg-3">{hint}</span>}
    </Card>
  );
}

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
        level: p.mentorLevel ? t(`progress.level.${p.mentorLevel}`) : null,
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

export function ProgressPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canMentor = useCan('mentorship:mentor');
  const q = useQuery(progress());
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[clamp(26px,4vw,34px)] font-bold">
            <Trophy className="size-7 text-accent-ink" aria-hidden /> {t('progress.title')}
          </h1>
          <p className="max-w-[60ch] text-fg-2">{t('progress.intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/leaderboard" className={buttonVariants({ size: 'sm' })}>
            <Medal className="size-4" aria-hidden /> {t('progress.leaderboard')}
          </Link>
          <Link to="/rewards" className={buttonVariants({ size: 'sm', variant: 'primary' })}>
            <Gift className="size-4" aria-hidden /> {t('progress.rewards')}
          </Link>
        </div>
      </div>

      <Card className="grid gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl font-bold">
            {t('progress.levelN', { level: p.level.level })}
          </h2>
          <span className="font-mono text-sm text-fg-2">
            {t('progress.xpToNext', { xp: p.xp, next: p.level.next })}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={t('progress.toNextLevel')}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-3 overflow-hidden rounded-full bg-surface-2"
        >
          <div
            className="fill-in h-full rounded-full bg-brand"
            style={{ transform: `scaleX(${pct / 100})` }}
          />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          icon={<Sparkles className="size-4" aria-hidden />}
          label={t('progress.xp')}
          value={String(p.xp)}
        />
        <Stat
          icon={<Flame className="size-4" aria-hidden />}
          label={t('progress.streak')}
          value={t('progress.days', { count: p.streak })}
          hint={t('progress.streakHint')}
        />
        <Stat
          icon={<Gift className="size-4" aria-hidden />}
          label={t('progress.balance')}
          value={String(p.balance.xp)}
        />
        <Stat
          icon={<Award className="size-4" aria-hidden />}
          label={t('progress.badges')}
          value={`${p.badges.length}/${BADGES.length}`}
        />
      </div>

      {(canMentor || p.impact > 0) && (
        <section aria-labelledby="impact" className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="impact" className="font-display text-lg font-semibold">
              {t('progress.impactTitle')}
            </h2>
            <div className="flex flex-wrap gap-2">
              <Link to="/wall-of-mentors" className={buttonVariants({ size: 'sm' })}>
                <Users className="size-4" aria-hidden /> {t('progress.wall')}
              </Link>
              <ImpactCardButton p={p} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              icon={<Sparkles className="size-4" aria-hidden />}
              label={t('progress.impact')}
              value={String(p.impact)}
            />
            <Stat
              icon={<Medal className="size-4" aria-hidden />}
              label={t('progress.mentorLevel')}
              value={p.mentorLevel ? t(`progress.level.${p.mentorLevel}`) : '—'}
              hint={t('progress.mentorLevelHint')}
            />
            <Stat
              icon={<Users className="size-4" aria-hidden />}
              label={t('progress.mentees')}
              value={String(p.menteesHelped)}
            />
            <Stat
              icon={<Award className="size-4" aria-hidden />}
              label={t('progress.sessions')}
              value={String(p.sessionsMentored)}
            />
          </div>
        </section>
      )}

      <section aria-labelledby="badges" className="grid gap-2">
        <h2 id="badges" className="font-display text-lg font-semibold">
          {t('progress.badges')}
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {BADGES.map((b) => {
            const at = earned.get(b);
            return (
              <li key={b}>
                <Card className={cn('grid h-full gap-1 p-3', !at && 'border-dashed bg-transparent')}>
                  <span className="flex items-center gap-2 font-semibold">
                    {at ? (
                      <Award className="size-5 text-accent-ink" aria-hidden />
                    ) : (
                      <Lock className="size-5 text-fg-3" aria-hidden />
                    )}
                    {t(`progress.badge.${b}.name`)}
                  </span>
                  <span className="text-sm text-fg-2">{t(`progress.badge.${b}.description`)}</span>
                  <span className="text-xs text-fg-3">
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
          <h2 id="recent" className="font-display text-lg font-semibold">
            {t('progress.recent')}
          </h2>
          {p.recent.length ? (
            <ul className="grid gap-1.5">
              {p.recent.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] bg-surface-1 px-3 py-2 text-sm"
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
                    <span className="text-xs text-fg-3">{formatRelative(e.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-2">{t('progress.nothingYet')}</p>
          )}
        </section>
        <section aria-labelledby="privacy" className="grid content-start gap-2">
          <h2 id="privacy" className="font-display text-lg font-semibold">
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
            <p className="text-xs text-fg-3">{t('progress.privacyHint')}</p>
          </Card>
          <h3 className="mt-2 text-sm font-semibold">{t('progress.howTitle')}</h3>
          <p className="text-sm text-fg-2">{t('progress.how')}</p>
        </section>
      </div>
    </div>
  );
}
