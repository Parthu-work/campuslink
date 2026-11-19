import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { DECLINE_TEMPLATES } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { OverflowMenu } from '../../components/ui/overflow-menu';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { answerRequest } from '../../lib/answers';
import { receivedRequests } from '../../lib/queries';

/** Monday 00:00 this week, on the device (the cap is a weekly count). */
const weekStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};

/**
 * The mentor's queue (prompt 3, U6): requests waiting, each with Accept in one tap and Decline with
 * one of the kind replies (the same templates as Requests), and the week's count against the cap.
 * Another time or a personal note stay on Requests.
 */
export function RequestsQueue({ weeklyCap }: { weeklyCap: number | null }) {
  const { t } = useTranslation();
  const q = useQuery(receivedRequests());
  if (!q.data) return null;
  const pending = q.data.filter((r) => r.status === 'pending');
  const since = weekStart();
  const thisWeek = q.data.filter((r) => Date.parse(r.createdAt) >= since).length;
  return (
    <div className="grid gap-2">
      <ListSection
        title={t('mentoring.queue.title')}
        action={
          weeklyCap ? (
            <span className="text-callout text-fg-2">
              {t('mentoring.queue.week', { count: thisWeek, cap: weeklyCap })}
            </span>
          ) : undefined
        }
      >
        {pending.length ? (
          pending.map((r) => (
            <ListRow
              key={r.id}
              leading={<PersonAvatar name={r.mentee.name} fileId={r.mentee.avatarFileId} size={40} />}
              title={`${r.mentee.name}: ${t(`session.type.${r.sessionType}`)}`}
              meta={r.message ?? r.goal ?? undefined}
              trailing={
                <span className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => answerRequest(r, { action: 'accept' }, e.currentTarget)}
                  >
                    {t('request.accept')}
                  </Button>
                  <OverflowMenu
                    label={t('mentoring.queue.declineLabel', { name: r.mentee.name })}
                    items={DECLINE_TEMPLATES.map((template) => ({
                      label: t(`mentoring.queue.as.${template}`),
                      onSelect: () => answerRequest(r, { action: 'decline', template }),
                    }))}
                  />
                </span>
              }
            />
          ))
        ) : (
          <ListRow title={t('mentoring.queue.none')} />
        )}
      </ListSection>
      <p className="text-callout text-fg-2">
        <Link to="/mentorship" className="hit font-semibold text-brand-ink hover:underline">
          {t('mentoring.queue.more')}
        </Link>
      </p>
    </div>
  );
}
