import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, FileUser, Trash2 } from 'lucide-react';
import {
  RESUME_TEMPLATES,
  RESUMES_PER_MEMBER,
  type ResumeSummaryView,
  type ResumeTemplate,
  type ResumeView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input } from '../../components/ui/field';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { api, ApiError } from '../../lib/api';
import { formatRelative, newIdempotencyKey } from '../../lib/format';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import { scoreTone } from './score';

/** A new résumé, prefilled by the server from the profile, academic record and finished roadmaps. */
function NewResumeDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState<ResumeTemplate>('classic');
  const [key] = useState(newIdempotencyKey);
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => api.postOnce<ResumeView>('/resumes', { title: title.trim(), template }, key),
    onSuccess: (r) => {
      qc.setQueryData(q.resume(r.id).queryKey, r);
      void qc.invalidateQueries({ queryKey: ['resumes'] });
      void navigate(`/resume/${r.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('resume.newTitle')}
      description={t('resume.newBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            type="submit"
            form="resume-new"
            loading={create.isPending}
            disabled={!title.trim()}
          >
            {t('resume.create')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <form
        id="resume-new"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) create.mutate();
        }}
      >
        <Field label={t('resume.name')} hint={t('resume.nameHint')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              maxLength={60}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-meta font-semibold">{t('resume.template')}</legend>
          <ChoiceGroup
            label={t('resume.template')}
            value={template}
            columns={2}
            options={RESUME_TEMPLATES.map((v) => ({
              value: v,
              label: t(`resume.templates.${v}`),
              detail: t(`resume.templateDetail.${v}`),
            }))}
            onChange={setTemplate}
          />
        </fieldset>
        {error && (
          <p role="alert" className="text-meta font-medium text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function ResumeRow({ resume: r }: { resume: ResumeSummaryView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.delete(`/resumes/${r.id}`),
    onSuccess: () => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ['resumes'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <li>
      <Card variant="interactive" className="relative grid gap-3 p-4">
        <div className="flex items-start gap-3">
          <FileUser className="mt-0.5 size-5 shrink-0 text-fg-2" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">
              <Link to={`/resume/${r.id}`} className="after:absolute after:inset-0">
                {r.title}
              </Link>
            </h2>
            <p className="text-meta text-fg-2">
              {t(`resume.templates.${r.template}`)} ·{' '}
              {t('resume.edited', { when: formatRelative(r.updatedAt) })}
            </p>
          </div>
          {r.atsScore !== null && (
            <Badge tone={scoreTone(r.atsScore)}>{t('resume.scoreShort', { n: r.atsScore })}</Badge>
          )}
        </div>
        <div className="relative z-10 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('resume.deleteNamed', { title: r.title })}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-4" aria-hidden /> {t('resume.delete')}
          </Button>
        </div>
      </Card>
      {confirming && (
        <Dialog
          open
          onOpenChange={(o) => !o && setConfirming(false)}
          title={t('resume.deleteTitle', { title: r.title })}
          footer={
            <div className="grid gap-2 sm:flex sm:flex-row-reverse">
              <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
                {t('resume.delete')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          }
        >
          <p className="text-meta text-fg-2">{t('resume.deleteBody')}</p>
        </Dialog>
      )}
    </li>
  );
}

/** My résumés (prompt 2, G2): up to five, each with its own template and last ATS score. */
export function ResumesPage() {
  const { t } = useTranslation();
  const list = useQuery({ ...SCREEN, ...q.resumes() });
  const [creating, setCreating] = useState(false);
  const full = (list.data?.length ?? 0) >= RESUMES_PER_MEMBER;
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-5">
      <PageHeader
        icon={<FileUser />}
        title={t('nav.resume')}
        intro={t('resume.intro')}
        actions={
          <Button variant="primary" disabled={!list.isSuccess || full} onClick={() => setCreating(true)}>
            <FilePlus2 className="size-4" aria-hidden /> {t('resume.new')}
          </Button>
        }
      />
      {full && <p className="text-meta text-fg-2">{t('resume.full', { n: RESUMES_PER_MEMBER })}</p>}
      {list.isLoading && <Skeleton className="h-32 rounded-[var(--radius-lg)]" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.isSuccess && !list.data.length && (
        <EmptyState
          art={<Illustration kind="empty" />}
          title={t('resume.emptyTitle')}
          action={
            <Button variant="primary" size="lg" onClick={() => setCreating(true)}>
              {t('resume.new')}
            </Button>
          }
        >
          {t('resume.emptyBody')}
        </EmptyState>
      )}
      {!!list.data?.length && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.data.map((r) => (
            <ResumeRow key={r.id} resume={r} />
          ))}
        </ul>
      )}
      <p className="text-caption text-fg-3">{t('resume.privacyNote')}</p>
      {creating && <NewResumeDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
