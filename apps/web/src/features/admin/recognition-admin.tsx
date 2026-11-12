import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Plus } from 'lucide-react';
import type { AlumniOfMonthView, PublicProfile } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Table, Td, Th, THead } from '../../components/ui/table';
import { api, ApiError } from '../../lib/api';
import { formatDay, newIdempotencyKey } from '../../lib/format';
import { useCan } from '../../lib/me';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

const fail = (t: (k: string) => string) => (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
const thisMonth = () => new Date().toISOString().slice(0, 7);

function NominateDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [month, setMonth] = useState(thisMonth);
  const [citation, setCitation] = useState('');
  const [key] = useState(newIdempotencyKey);
  const people = useQuery({
    queryKey: ['alumni-search', search],
    queryFn: () =>
      api.get<PublicProfile[]>(
        `/directory?role=ALUMNI&limit=20${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ''}`,
      ),
  });
  const save = useMutation({
    mutationFn: () =>
      api.postOnce('/admin/recognition/of-the-month', { userId, month, citation: citation.trim() }, key),
    onSuccess: () => {
      toast.success(t('alumniAdmin.ofMonth.nominated'));
      void qc.invalidateQueries({ queryKey: ['admin-nominations'] });
      onClose();
    },
    onError: fail(t),
  });
  const ready = !!userId && /^\d{4}-\d{2}$/.test(month) && citation.trim().length >= 10;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('alumniAdmin.ofMonth.title')}
      description={t('alumniAdmin.ofMonth.body')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button variant="primary" type="submit" form="nominate" loading={save.isPending} disabled={!ready}>
            {t('alumniAdmin.ofMonth.nominate')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <form
        id="nominate"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) save.mutate();
        }}
      >
        <Field label={t('alumniAdmin.ofMonth.search')}>
          {({ id }) => <Input id={id} value={search} onChange={(e) => setSearch(e.target.value)} />}
        </Field>
        <Field label={t('alumniAdmin.ofMonth.who')}>
          {({ id }) => (
            <Select id={id} value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">{t('alumniAdmin.ofMonth.pick')}</option>
              {(people.data ?? []).map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('alumniAdmin.ofMonth.month')}>
          {({ id }) => (
            <Input id={id} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          )}
        </Field>
        <Field label={t('alumniAdmin.ofMonth.citation')} hint={t('alumniAdmin.ofMonth.citationHint')}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              maxLength={300}
              value={citation}
              onChange={(e) => setCitation(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function AnnounceDialog({ n, onClose }: { n: AlumniOfMonthView; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [body, setBody] = useState(() =>
    t('alumniAdmin.ofMonth.template', { name: n.person.name, month: n.month, citation: n.citation }),
  );
  const [key] = useState(newIdempotencyKey);
  const post = useMutation({
    mutationFn: () =>
      api.postOnce(`/admin/recognition/of-the-month/${n.id}/announce`, { body: body.trim() }, key),
    onSuccess: () => {
      toast.success(t('alumniAdmin.ofMonth.announced'));
      void qc.invalidateQueries({ queryKey: ['admin-nominations'] });
      onClose();
    },
    onError: fail(t),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('alumniAdmin.ofMonth.announceTitle')}
      description={t('alumniAdmin.ofMonth.announceBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            loading={post.isPending}
            disabled={body.trim().length < 10}
            onClick={() => post.mutate()}
          >
            {t('alumniAdmin.ofMonth.post')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <Field label={t('alumniAdmin.ofMonth.text')}>
        {({ id }) => (
          <Textarea
            id={id}
            rows={6}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

/** Admin › Recognition (prompt 2, G6): the alumnus of the month and mentorship certificates. */
export function RecognitionAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canAnnounce = useCan('announcements:post');
  const nominations = useQuery({ ...SCREEN, ...q.adminNominations() });
  const certificates = useQuery(q.adminCertificates());
  const [nominating, setNominating] = useState(false);
  const [announcing, setAnnouncing] = useState<AlumniOfMonthView | null>(null);
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/admin/recognition/certificates/${id}/revoke`),
    onSuccess: () => {
      toast.success(t('alumniAdmin.certs.revoked'));
      void qc.invalidateQueries({ queryKey: ['admin-certificates'] });
    },
    onError: fail(t),
  });
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[60ch] text-callout text-fg-2">{t('alumniAdmin.recognitionIntro')}</p>
        <Button variant="primary" onClick={() => setNominating(true)}>
          <Plus className="size-4" aria-hidden /> {t('alumniAdmin.ofMonth.nominate')}
        </Button>
      </div>
      <section aria-labelledby="of-month" className="grid gap-3">
        <h2 id="of-month" className="text-headline font-semibold">
          {t('alumniAdmin.ofMonth.heading')}
        </h2>
        {nominations.isLoading && <Skeleton className="h-32" />}
        {nominations.isError && (
          <ErrorState error={nominations.error} onRetry={() => void nominations.refetch()} />
        )}
        {nominations.data && !nominations.data.length && (
          <EmptyState art={<Illustration kind="people" />} title={t('alumniAdmin.ofMonth.empty')} />
        )}
        <ul className="grid gap-3 md:grid-cols-2">
          {nominations.data?.map((n) => (
            <li key={n.id}>
              <Card className="grid gap-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{n.person.name}</b>
                  <Badge mono>{n.month}</Badge>
                  <Badge
                    tone={n.status === 'published' ? 'success' : n.status === 'declined' ? 'neutral' : 'info'}
                  >
                    {t(`alumniAdmin.ofMonth.status.${n.status}`)}
                  </Badge>
                </div>
                <p className="text-callout text-fg-2">{n.citation}</p>
                {n.status === 'published' && !n.announced && canAnnounce && (
                  <Button size="sm" className="justify-self-start" onClick={() => setAnnouncing(n)}>
                    <Megaphone className="size-4" aria-hidden /> {t('alumniAdmin.ofMonth.announce')}
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="certs" className="grid gap-3">
        <h2 id="certs" className="text-headline font-semibold">
          {t('alumniAdmin.certs.heading')}
        </h2>
        {certificates.data && !certificates.data.length ? (
          <p className="text-callout text-fg-2">{t('alumniAdmin.certs.empty')}</p>
        ) : (
          <Table label={t('alumniAdmin.certs.heading')}>
            <THead>
              <tr>
                <Th>{t('alumniAdmin.certs.who')}</Th>
                <Th>{t('alumniAdmin.certs.year')}</Th>
                <Th>{t('alumniAdmin.certs.issued')}</Th>
                <Th>{t('alumniAdmin.certs.status')}</Th>
                <Th>
                  <span className="sr-only">{t('alumniAdmin.certs.actions')}</span>
                </Th>
              </tr>
            </THead>
            <tbody>
              {certificates.data?.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <Td>{c.person.name}</Td>
                  <Td>{c.academicYear}</Td>
                  <Td>{formatDay(c.issuedAt)}</Td>
                  <Td>{t(`alumni.certs.status.${c.status}`)}</Td>
                  <Td>
                    {c.status !== 'revoked' && (
                      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(c.id)}>
                        {t('alumniAdmin.certs.revoke')}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      {nominating && <NominateDialog onClose={() => setNominating(false)} />}
      {announcing && <AnnounceDialog n={announcing} onClose={() => setAnnouncing(null)} />}
    </div>
  );
}
