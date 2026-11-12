import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RESUME_COMMENT_SECTIONS, type ResumeCommentView, type ResumeView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Select, Textarea } from '../../components/ui/field';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import * as q from '../../lib/queries';

type Section = (typeof RESUME_COMMENT_SECTIONS)[number];

/** Review comments, by section (prompt 2, G2): the owner and the alumni they asked to review. */
export function ResumeComments({ resume: r }: { resume: ResumeView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery(q.resumeComments(r.id));
  const [section, setSection] = useState<Section>('general');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const send = useMutation({
    mutationFn: () =>
      api.post<ResumeCommentView>(`/resumes/${r.id}/comments`, { section, body: body.trim() }),
    onSuccess: () => {
      setBody('');
      setError('');
      void qc.invalidateQueries({ queryKey: ['resume-comments', r.id] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <section aria-labelledby="resume-comments" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="resume-comments" className="text-headline font-semibold">
          {t('resume.comments.title')}
        </h2>
        <p className="max-w-[60ch] text-callout text-fg-2">
          {r.mine
            ? t('resume.comments.introOwner')
            : t('resume.comments.introReviewer', { name: r.owner.name })}
        </p>
      </div>
      {list.isLoading && <Skeleton className="h-24 rounded-[var(--radius-lg)]" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.isSuccess && !list.data.length && (
        <p className="text-callout text-fg-3">{t('resume.comments.none')}</p>
      )}
      {!!list.data?.length && (
        <ul className="grid gap-2">
          {list.data.map((c) => (
            <li key={c.id}>
              <Card variant="raised" className="grid gap-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-callout">
                    {c.mine ? t('resume.comments.you') : (c.author?.name ?? t('resume.comments.removed'))}
                  </b>
                  <Badge tone="neutral">{t(`resume.section.${c.section}`)}</Badge>
                  {c.resumeVersion !== r.version && (
                    <Badge tone="warning">{t('resume.comments.older')}</Badge>
                  )}
                </div>
                <p className="text-callout whitespace-pre-line">{c.body}</p>
                <p className="text-caption text-fg-3">{formatRelative(c.createdAt)}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim().length >= 2) send.mutate();
        }}
      >
        <Field label={t('resume.comments.about')}>
          {({ id }) => (
            <Select id={id} value={section} onChange={(e) => setSection(e.target.value as Section)}>
              {RESUME_COMMENT_SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`resume.section.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('resume.comments.add')} error={error || undefined}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              rows={3}
              maxLength={1000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          )}
        </Field>
        <div>
          <Button type="submit" variant="primary" loading={send.isPending} disabled={body.trim().length < 2}>
            {t('resume.comments.send')}
          </Button>
        </div>
      </form>
    </section>
  );
}
