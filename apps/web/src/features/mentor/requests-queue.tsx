import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DECLINE_TEMPLATES, type DeclineTemplate, type RequestView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { OverflowMenu } from '../../components/ui/overflow-menu';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { api } from '../../lib/api';
import { receivedRequests } from '../../lib/queries';
import { toast } from '../../lib/toast';
import { firstName } from '../../lib/names';

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
  const qc = useQueryClient();
  const q = useQuery(receivedRequests());
  const respond = useMutation({
    mutationFn: ({
      r,
      body,
    }: {
      r: RequestView;
      body: { action: 'accept' } | { action: 'decline'; template: DeclineTemplate };
    }) => api.post<RequestView>(`/mentorship/requests/${r.id}/respond`, body),
    onSuccess: (_, { r, body }) => {
      void qc.invalidateQueries({ queryKey: ['requests'] });
      void qc.invalidateQueries({ queryKey: ['impact'] });
      toast.success(
        body.action === 'accept'
          ? t('request.acceptedToast', { name: firstName(r.mentee.name) })
          : t('request.declinedToast', { name: firstName(r.mentee.name) }),
      );
    },
  });
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
                    loading={
                      respond.isPending &&
                      respond.variables?.r.id === r.id &&
                      respond.variables.body.action === 'accept'
                    }
                    onClick={() => respond.mutate({ r, body: { action: 'accept' } })}
                  >
                    {t('request.accept')}
                  </Button>
                  <OverflowMenu
                    label={t('mentoring.queue.declineLabel', { name: r.mentee.name })}
                    items={DECLINE_TEMPLATES.map((template) => ({
                      label: t(`mentoring.queue.as.${template}`),
                      onSelect: () => respond.mutate({ r, body: { action: 'decline', template } }),
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
        <Link to="/mentorship" className="font-semibold text-brand-ink hover:underline">
          {t('mentoring.queue.more')}
        </Link>
      </p>
    </div>
  );
}
