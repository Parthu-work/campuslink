import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Link2 } from 'lucide-react';
import type { CalendarFeedLink, CalendarFeedView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Input } from '../../components/ui/field';
import { Card } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { toast } from '../../lib/toast';

const KEY = ['calendar-feed'];

/** Settings › Notifications: the member's calendar feed (prompt 2, G9). */
export function CalendarFeedCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const v = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api.get<CalendarFeedView>('/me/calendar-feed', signal),
  });
  // The link is shown once, right after it is made (only its hash is stored).
  const [link, setLink] = useState<CalendarFeedLink | null>(null);
  const failed = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const issue = useMutation({
    mutationFn: () => api.post<CalendarFeedLink>('/me/calendar-feed', {}),
    onSuccess: (l) => {
      if (v.data?.enabled) toast.success(t('reach.calendar.replaced'));
      setLink(l);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: failed,
  });
  const off = useMutation({
    mutationFn: () => api.delete<CalendarFeedView>('/me/calendar-feed'),
    onSuccess: (d) => {
      setLink(null);
      qc.setQueryData(KEY, d);
      toast.success(t('reach.calendar.offDone'));
    },
    onError: failed,
  });
  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link.url).catch(() => undefined);
    toast.success(t('reach.calendar.copied'));
  };
  const on = v.data?.enabled;
  return (
    <Card className="grid gap-3 p-5" role="region" aria-labelledby="calendar-feed-title">
      <h2 id="calendar-feed-title" className="flex items-center gap-2 text-headline font-semibold">
        <CalendarPlus className="size-5 text-brand-ink" aria-hidden /> {t('reach.calendar.title')}
      </h2>
      <p className="text-callout text-fg-2">{t('reach.calendar.intro')}</p>
      {on && !link && (
        <p className="text-callout">
          {v.data?.lastFetchedAt
            ? t('reach.calendar.onSince', { when: formatRelative(v.data.lastFetchedAt) })
            : t('reach.calendar.onNever')}
        </p>
      )}
      {link && (
        <div className="grid gap-2">
          <Input
            readOnly
            value={link.url}
            aria-label={t('reach.calendar.title')}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-caption"
          />
          <p className="text-caption text-fg-3">{t('reach.calendar.private')}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void copy()}>
              <Link2 className="size-4" aria-hidden /> {t('reach.calendar.copy')}
            </Button>
            <a href={link.google} target="_blank" rel="noreferrer" className={buttonVariants({ size: 'sm' })}>
              {t('reach.calendar.google')}
            </a>
            <a href={link.webcal} className={buttonVariants({ size: 'sm' })}>
              {t('reach.calendar.apple')}
            </a>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {on || link ? (
          <>
            <Button size="sm" loading={issue.isPending} onClick={() => issue.mutate()}>
              {t('reach.calendar.replace')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger-ink"
              loading={off.isPending}
              onClick={() => off.mutate()}
            >
              {t('reach.calendar.off')}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            loading={issue.isPending}
            disabled={v.isLoading}
            onClick={() => issue.mutate()}
          >
            {t('reach.calendar.get')}
          </Button>
        )}
      </div>
    </Card>
  );
}
