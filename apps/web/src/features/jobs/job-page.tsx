import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { BadgeCheck, BriefcaseBusiness, ExternalLink, FileText, HandHelping, Users } from 'lucide-react';
import { TRACK_STATUSES, type JobView, type ReferrerView, type TrackStatus } from '@campuslink/shared';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Select, Textarea } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { RichText } from '../../components/ui/rich-text';
import { api, ApiError } from '../../lib/api';
import { job } from '../../lib/queries';
import { findCached, hasId } from '../../lib/query-seed';
import { useCan } from '../../lib/me';
import { formatDateTime, newIdempotencyKey } from '../../lib/format';
import { formatSalary, useTrack } from '../../lib/jobs';
import { AuthorLine } from '../feed/post-card';
import { ContentMenu, RemovalNotice } from '../feed/content-menu';
import { JobFacts, SaveJobButton } from './job-card';

function ReferralDialog({
  job,
  referrer,
  onClose,
}: {
  job: JobView;
  referrer: ReferrerView;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [why, setWhy] = useState('');
  const [resume, setResume] = useState<{ id: string; name: string } | null>(null);
  const [key] = useState(newIdempotencyKey);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const form = new FormData();
      form.append('file', f);
      return { r: await api.upload<{ id: string }>('/referrals/resume', form), name: f.name };
    },
    onSuccess: ({ r, name }) => setResume({ id: r.id, name }),
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const send = useMutation({
    mutationFn: () =>
      api.postOnce(
        '/referrals',
        {
          jobId: job.id,
          referrerId: referrer.userId,
          why: why.trim(),
          ...(resume ? { resumeFileId: resume.id } : {}),
        },
        key,
      ),
    onSuccess: () => {
      toast.success(t('referrals.sent', { name: referrer.name }));
      void qc.invalidateQueries({ queryKey: ['referrals'] });
      void qc.invalidateQueries({ queryKey: ['job', job.id, 'referrers'] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('referrals.askTitle', { name: referrer.name })}
      description={t('referrals.askBody', { company: job.company })}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <Field label={t('referrals.why')} hint={t('referrals.whyHint')}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              minLength={30}
              maxLength={800}
              required
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              className="min-h-[120px]"
            />
          )}
        </Field>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" loading={upload.isPending} onClick={() => fileRef.current?.click()}>
            <FileText className="size-4" aria-hidden />{' '}
            {resume ? t('referrals.replaceResume') : t('referrals.addResume')}
          </Button>
          <span className="text-sm text-fg-2" aria-live="polite">
            {resume ? resume.name : t('referrals.resumeHint')}
          </span>
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={why.trim().length < 30 || upload.isPending}
            loading={send.isPending}
          >
            {t('referrals.send')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Referrers({ job }: { job: JobView }) {
  const { t } = useTranslation();
  const canRequest = useCan('referrals:request');
  const [asking, setAsking] = useState<ReferrerView | null>(null);
  const q = useQuery({
    queryKey: ['job', job.id, 'referrers'],
    queryFn: () => api.get<ReferrerView[]>(`/jobs/${job.id}/referrers`),
    enabled: canRequest && job.status === 'open' && job.referrers > 0,
  });
  return (
    <Card className="grid gap-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Users className="size-5 text-brand-ink" aria-hidden /> {t('jobs.alumniAt', { company: job.company })}
      </h2>
      {job.alumniCount === 0 ? (
        <p className="text-sm text-fg-2">{t('jobs.noAlumni')}</p>
      ) : (
        <p className="text-sm text-fg-2">
          {t('jobs.alumniCount', { count: job.alumniCount })}{' '}
          {job.referrers > 0 ? t('jobs.referrersCount', { count: job.referrers }) : t('jobs.noReferrers')}
        </p>
      )}
      {q.isLoading && <Skeleton className="h-14" />}
      <ul className="grid gap-3">
        {q.data?.map((r) => (
          <li key={r.userId} className="flex flex-wrap items-center gap-3">
            <PersonAvatar name={r.name} fileId={r.avatarFileId} size={40} />
            <div className="min-w-0 flex-1">
              <Link
                to={`/people/${r.userId}`}
                className="flex items-center gap-1 font-semibold hover:underline"
              >
                {r.name}
                {r.companyVerified && (
                  <BadgeCheck className="size-4 text-brand-ink" aria-label={t('jobs.companyVerified')} />
                )}
              </Link>
              <p className="truncate text-xs text-fg-3">
                {[r.jobTitle, r.branch, r.gradYear && t('jobs.batch', { year: r.gradYear })]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {r.note && <p className="text-xs text-fg-2">“{r.note}”</p>}
            </div>
            <Button size="sm" variant="primary" disabled={!r.available} onClick={() => setAsking(r)}>
              <HandHelping className="size-4" aria-hidden />
              {r.available ? t('referrals.ask') : t('referrals.capReached')}
              <span className="sr-only"> {r.name}</span>
            </Button>
          </li>
        ))}
      </ul>
      {asking && <ReferralDialog job={job} referrer={asking} onClose={() => setAsking(null)} />}
    </Card>
  );
}

function TrackControl({ job }: { job: JobView }) {
  const { t } = useTranslation();
  const track = useTrack(job);
  const [note, setNote] = useState(job.track?.note ?? '');
  return (
    <Card className="grid gap-3 p-4">
      <h2 className="font-semibold">{t('jobs.myProgress')}</h2>
      <label className="grid gap-1.5 text-[13px] font-semibold">
        {t('jobs.status')}
        <Select
          value={job.track?.status ?? ''}
          onChange={(e) => track.mutate({ status: (e.target.value || null) as TrackStatus | null })}
        >
          <option value="">{t('jobs.notSaved')}</option>
          {TRACK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`jobs.track.${s}`)}
            </option>
          ))}
        </Select>
      </label>
      {job.track && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            track.mutate({ status: job.track?.status ?? 'saved', note });
            toast.success(t('jobs.noteSaved'));
          }}
        >
          <label className="grid gap-1.5 text-[13px] font-semibold">
            {t('jobs.privateNote')}
            <Textarea
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-[72px]"
            />
          </label>
          <Button size="sm" type="submit" className="justify-self-end">
            {t('common.save')}
          </Button>
        </form>
      )}
    </Card>
  );
}

export function JobPage() {
  const { t } = useTranslation();
  const { jobId = '' } = useParams();
  const qc = useQueryClient();
  const canSave = useCan('jobs:save');
  const q = useQuery({
    ...job(jobId),
    // Draw the card the member tapped at once; the full record replaces it when it arrives.
    placeholderData: () => {
      const row = findCached(qc, [['jobs']], hasId<JobView>('id', jobId, ['company', 'applyUrl', 'status']));
      return row ? { ...row, removal: null } : undefined;
    },
  });
  const track = useTrack({ id: jobId });
  const close = useMutation({
    mutationFn: () => api.post(`/jobs/${jobId}/close`, {}),
    onSuccess: () => {
      toast.success(t('jobs.closed'));
      void qc.invalidateQueries({ queryKey: ['job', jobId] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const [askApplied, setAskApplied] = useState(false);
  const j = q.data;
  return (
    <div className="mx-auto grid w-full max-w-[860px] gap-4">
      <BackLink to="/jobs">{t('jobs.back')}</BackLink>
      {q.isLoading && <Skeleton className="h-60" />}
      {q.isError && (
        <EmptyState icon={<BriefcaseBusiness className="size-6" />} title={t('jobs.gone')}>
          {t('jobs.goneBody')}
        </EmptyState>
      )}
      {j && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid min-w-0 content-start gap-4">
            <Card className="grid grid-cols-[minmax(0,1fr)] gap-3 p-5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h1
                    className="text-headline leading-tight font-bold"
                    style={{ viewTransitionName: `job-${j.id}` }}
                  >
                    {j.title}
                  </h1>
                  <p className="text-lead text-fg-2">{j.company}</p>
                </div>
                <SaveJobButton job={j} />
                <ContentMenu
                  targetType="job"
                  targetId={j.id}
                  authorId={j.postedBy?.userId ?? ''}
                  authorName={j.postedBy?.name ?? j.company}
                  isMine={j.isMine}
                />
              </div>
              <JobFacts job={j} />
              <p className="flex flex-wrap gap-1.5">
                {j.status !== 'open' && <Badge tone="warning">{t(`jobs.statusLabel.${j.status}`)}</Badge>}
                {j.freshersOk && <Badge tone="success">{t('jobs.fresherFriendly')}</Badge>}
                {j.salary && <Badge>{formatSalary(j.salary)}</Badge>}
                {j.branches.map((b) => (
                  <Badge key={b}>{b}</Badge>
                ))}
              </p>
              {j.removal && (
                <RemovalNotice targetType="job" targetId={j.id} removal={j.removal} canAppeal={j.isMine} />
              )}
              <div className="flex flex-wrap gap-2">
                {j.status === 'open' && (
                  <a
                    href={j.applyUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    onClick={() => canSave && (!j.track || j.track.status === 'saved') && setAskApplied(true)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-on-brand"
                  >
                    {t('jobs.apply')} <ExternalLink className="size-4" aria-hidden />
                    <span className="sr-only">({t('jobs.opensEmployer')})</span>
                  </a>
                )}
                {j.isMine && j.status === 'open' && (
                  <Button loading={close.isPending} onClick={() => close.mutate()}>
                    {t('jobs.close')}
                  </Button>
                )}
              </div>
              {askApplied && (
                <div
                  role="status"
                  className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] bg-surface-2 p-3 text-sm"
                >
                  {t('jobs.didYouApply')}
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      track.mutate({ status: 'applied' });
                      setAskApplied(false);
                    }}
                  >
                    {t('jobs.markApplied')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAskApplied(false)}>
                    {t('jobs.notYet')}
                  </Button>
                </div>
              )}
            </Card>
            <Card className="grid grid-cols-[minmax(0,1fr)] gap-3 p-5">
              <h2 className="font-semibold">{t('jobs.aboutRole')}</h2>
              <RichText text={j.description || t('jobs.noDescription')} />
              {j.skills.length > 0 && (
                <p className="flex flex-wrap gap-1.5" aria-label={t('jobs.skills')}>
                  {j.skills.map((s) => (
                    <Badge key={s}>{s}</Badge>
                  ))}
                </p>
              )}
              <p className="text-xs text-fg-3">
                {j.postedBy ? (
                  <span className="block">
                    <AuthorLine author={j.postedBy} at={j.postedAt} />
                  </span>
                ) : (
                  t('jobs.importedFrom', { source: j.source?.attribution ?? j.source?.name ?? j.origin })
                )}
                <span className="mt-1 block">{t('jobs.expires', { when: formatDateTime(j.expiresAt) })}</span>
              </p>
            </Card>
          </div>
          <div className="grid content-start gap-4">
            <Referrers job={j} />
            {canSave && <TrackControl key={j.track?.updatedAt ?? 'none'} job={j} />}
          </div>
        </div>
      )}
    </div>
  );
}
