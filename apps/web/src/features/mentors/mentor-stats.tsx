import { CalendarClock, MessageCircleReply, Star, Video } from 'lucide-react';
import type { MentorStats } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { formatDateTime } from '../../lib/format';

/**
 * A mentor's track record in one line or a small list (B5): how fast they usually reply, how many
 * sessions they ran, their rating, and the next time the viewer could book. Each piece shows only
 * when there is enough data behind it (the API leaves it null otherwise).
 */
export function MentorStatsLine({
  stats,
  layout = 'line',
}: {
  stats: MentorStats;
  layout?: 'line' | 'list';
}) {
  const { t } = useTranslation();
  const items: { key: string; icon: typeof Star; text: string }[] = [];
  const h = stats.medianReplyHours;
  if (h !== null)
    items.push({
      key: 'reply',
      icon: MessageCircleReply,
      text:
        h < 24
          ? t('mentorStats.replyHours', { count: Math.max(1, Math.round(h)) })
          : t('mentorStats.replyDays', { count: Math.round(h / 24) }),
    });
  else if (stats.replyBand)
    items.push({ key: 'band', icon: MessageCircleReply, text: t(`mentorStats.band.${stats.replyBand}`) });
  if (stats.sessionsCompleted > 0)
    items.push({
      key: 'sessions',
      icon: Video,
      text: t('mentorStats.sessions', { count: stats.sessionsCompleted }),
    });
  if (stats.rating !== null)
    items.push({
      key: 'rating',
      icon: Star,
      text: t('mentorStats.rating', { rating: stats.rating.toFixed(1), count: stats.reviewCount }),
    });
  if (layout === 'list' && stats.nextFreeSlot)
    items.push({
      key: 'slot',
      icon: CalendarClock,
      text: t('mentorStats.nextSlot', { when: formatDateTime(stats.nextFreeSlot) }),
    });
  if (!items.length) return null;
  return (
    <ul
      aria-label={t('mentorStats.label')}
      className={
        layout === 'line' ? 'flex flex-wrap gap-x-3 gap-y-1 text-caption text-fg-2' : 'grid gap-2 text-meta'
      }
    >
      {items.map(({ key, icon: Icon, text }) => (
        <li key={key} className="inline-flex items-center gap-1.5">
          <Icon className="size-4 flex-none text-brand-ink" aria-hidden />
          {text}
        </li>
      ))}
    </ul>
  );
}
