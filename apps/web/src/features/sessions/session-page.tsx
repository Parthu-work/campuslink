import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarX2 } from 'lucide-react';
import { BOOKING_NOTES_MAX, type BookingDetailView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { Field, Textarea } from '../../components/ui/field';
import { EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { ApiError, api } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { toast } from '../../lib/toast';
import { BookingCard } from './sessions';

const bookingQuery = (id: string) => ({
  queryKey: ['booking', id],
  queryFn: () => api.get<BookingDetailView>(`/bookings/${id}`),
});

/** Notes both participants share (prompt 3, U6): an agenda, links, what they agreed. */
function SharedNotes({ b }: { b: BookingDetailView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? b.notes;
  const readOnly = b.status === 'cancelled';
  const save = useMutation({
    mutationFn: () => api.put<BookingDetailView>(`/bookings/${b.id}/notes`, { notes: value }),
    onSuccess: (next) => {
      qc.setQueryData(['booking', b.id], next);
      setDraft(null);
      toast.success(t('mentoring.session.saved'));
    },
  });
  const who =
    b.notesBy === b.role ? t('mentoring.session.you') : (b.notesBy === 'mentor' ? b.mentor : b.mentee).name;
  return (
    <section aria-labelledby="notes-h" className="grid gap-2">
      <h2 id="notes-h" className="text-headline font-semibold">
        {t('mentoring.session.notes')}
      </h2>
      {readOnly && <p className="text-callout text-fg-2">{t('mentoring.session.readOnly')}</p>}
      <Field
        label={<span className="sr-only">{t('mentoring.session.notes')}</span>}
        hint={t('mentoring.session.notesHint')}
        error={
          save.error instanceof ApiError ? save.error.message : save.error ? t('errors.generic') : undefined
        }
        aside={<span className="tabular">{`${value.length}/${BOOKING_NOTES_MAX}`}</span>}
      >
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            rows={8}
            maxLength={BOOKING_NOTES_MAX}
            readOnly={readOnly}
            value={value}
            onChange={(e) => setDraft(e.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        {!readOnly && (
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={draft === null}
            onClick={() => save.mutate()}
          >
            {t('mentoring.session.save')}
          </Button>
        )}
        {b.notesUpdatedAt && b.notesBy && (
          <p className="text-callout text-fg-2" role="status">
            {t('mentoring.session.savedBy', { who, when: formatRelative(b.notesUpdatedAt) })}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * One session (prompt 3, U6): its time and Join (open from 10 minutes before), what it is for (the
 * request's message), notes both participants share, and after it the feedback and the review
 * prompt (the same card as Sessions, so every action behaves the same).
 */
export function SessionPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const now = useNow();
  const valid = /^[a-f0-9]{24}$/.test(id);
  const q = useQuery({ ...bookingQuery(id), enabled: valid, retry: false });
  const back = <BackLink to="/sessions">{t('nav.sessions')}</BackLink>;
  if (valid && q.isLoading)
    return (
      <div className="mx-auto grid w-full max-w-[760px] gap-4">
        {back}
        <Skeleton className="h-64" />
      </div>
    );
  if (!q.data)
    return (
      <div className="mx-auto grid w-full max-w-[760px] gap-4">
        {back}
        <EmptyState icon={<CalendarX2 className="size-6" />} title={t('mentoring.session.notFound')} />
      </div>
    );
  const b = q.data;
  const other = b.role === 'mentor' ? b.mentee : b.mentor;
  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-6">
      <PageHeader
        as="div"
        back={back}
        title={t('mentoring.session.title', { type: t(`session.type.${b.sessionType}`), name: other.name })}
      />
      <BookingCard b={b} now={now} autoJoin={params.get('join') === '1'} onPage />
      <section aria-labelledby="agenda-h" className="grid gap-2">
        <h2 id="agenda-h" className="text-headline font-semibold">
          {t('mentoring.session.agenda')}
        </h2>
        {b.agenda ? (
          <p className="text-body whitespace-pre-line">{b.agenda}</p>
        ) : (
          <p className="text-callout text-fg-2">{t('mentoring.session.noAgenda')}</p>
        )}
      </section>
      <SharedNotes b={b} />
    </div>
  );
}
