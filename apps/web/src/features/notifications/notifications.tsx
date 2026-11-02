import { Link } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck } from 'lucide-react';
import { IntentLink } from '../../components/ui/intent-link';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Illustration } from '../../components/ui/illustration';
import { Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { api } from '../../lib/api';
import { notifications } from '../../lib/queries';
import { formatRelative } from '../../lib/format';
import { notificationText } from '../../lib/notification-text';
import { cn } from '../../lib/cn';
import { SCREEN } from '../../lib/query-client';

export function NotificationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({ ...notifications(), ...SCREEN });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: ['notifications-unread'] });
  };
  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read', { all: true }),
    onSuccess: refresh,
  });
  const readOne = useMutation({
    mutationFn: (id: string) => api.post('/notifications/read', { ids: [id] }),
    onSuccess: refresh,
  });
  const unread = list.data?.filter((n) => !n.readAt).length ?? 0;
  return (
    <>
      <PageHeader
        title={t('nav.notifications')}
        actions={
          <>
            <Link
              to="/settings/notifications"
              className="rounded-full px-3 py-2 text-meta font-semibold text-brand-ink hover:bg-surface-2"
            >
              {t('notifications.settings')}
            </Link>
            {unread > 0 && (
              <Button size="sm" loading={readAll.isPending} onClick={() => readAll.mutate()}>
                <CheckCheck className="size-4" aria-hidden /> {t('notifications.readAll')}
              </Button>
            )}
          </>
        }
      />
      {list.isLoading && <Skeleton className="h-40" />}
      {list.isSuccess && !list.data.length && (
        <EmptyState
          art={<Illustration kind="done" />}
          title={t('notifications.empty')}
          action={
            <Link to="/home" className={buttonVariants({ variant: 'outline' })}>
              {t('notifications.emptyAction')}
            </Link>
          }
        >
          {t('notifications.emptyBody')}
        </EmptyState>
      )}
      <ul className="grid gap-2">
        {list.data?.map((n) => {
          const text = notificationText(t, n);
          return (
            <li key={n.id}>
              <IntentLink
                to={text.href}
                onClick={() => !n.readAt && readOne.mutate(n.id)}
                className="block rounded-[var(--radius-md)]"
              >
                <Card
                  className={cn(
                    'flex items-start gap-3 p-3.5 transition-colors hover:border-line-strong',
                    !n.readAt && 'border-[color-mix(in_srgb,var(--brand)_45%,var(--line))]',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-2 size-2 flex-none rounded-full',
                      n.readAt ? 'bg-transparent' : 'bg-brand',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <b className="block">{text.title}</b>
                    <p className="text-meta text-fg-2">{text.body}</p>
                    <p className="text-caption text-fg-3">
                      {formatRelative(n.createdAt)}
                      {!n.readAt && <span className="sr-only"> · {t('notifications.unread')}</span>}
                    </p>
                  </div>
                </Card>
              </IntentLink>
            </li>
          );
        })}
      </ul>
    </>
  );
}
