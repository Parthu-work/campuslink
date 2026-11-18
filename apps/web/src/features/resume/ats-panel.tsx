import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ScanText, X } from 'lucide-react';
import { atsScoreFor, type AtsReport, type ResumeContent, type ResumeView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Field, Select, Textarea } from '../../components/ui/field';
import { ListSection } from '../../components/ui/list-row';
import { Badge } from '../../components/ui/misc';
import { ProgressRing } from '../../components/ui/progress';
import { api, ApiError } from '../../lib/api';
import { useCan } from '../../lib/me';
import { formatRelative } from '../../lib/format';
import * as q from '../../lib/queries';

type Against = 'none' | 'pasted' | 'drive';

/**
 * The live score (prompt 3, U7): the same rules as the check, run on what is on screen, with the
 * last check's page count and keywords. The check itself reads the saved PDF.
 */
function useLiveScore(content: ResumeContent, report: AtsReport | null) {
  const keywords = report?.keywords ? [...report.keywords.matched, ...report.keywords.missing] : null;
  return atsScoreFor(content, report?.pages ?? 1, keywords);
}

/**
 * The ATS check (prompt 2, G2; prompt 3, U7): a checklist with what to fix, a score that moves as
 * the member types, and the words of a role the résumé shows. A guide to a readable résumé, never a
 * claim about any employer's system.
 */
export function AtsPanel({
  resume: r,
  content,
  dirty,
}: {
  resume: ResumeView;
  content: ResumeContent;
  dirty: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canDrives = useCan('placements:view');
  const [against, setAgainst] = useState<Against>('none');
  const [jd, setJd] = useState('');
  const [driveId, setDriveId] = useState('');
  const [error, setError] = useState('');
  const drives = useQuery({ ...q.placementDrives('eligible'), enabled: canDrives && against === 'drive' });
  const check = useMutation({
    mutationFn: () =>
      api.post<AtsReport>(`/resumes/${r.id}/ats`, {
        ...(against === 'pasted' && jd.trim() ? { jobDescription: jd.trim() } : {}),
        ...(against === 'drive' && driveId ? { driveId } : {}),
      }),
    onSuccess: (report) => {
      setError('');
      qc.setQueryData(q.resume(r.id).queryKey, (old?: ResumeView) =>
        old ? { ...old, atsReport: report, atsScore: report.score } : old,
      );
      void qc.invalidateQueries({ queryKey: ['resumes'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const report = check.data ?? r.atsReport;
  const live = useLiveScore(content, report);
  const ready = against === 'none' || (against === 'pasted' ? jd.trim().length >= 30 : !!driveId);
  const choices = [
    { value: 'none' as const, label: t('resume.ats.none') },
    { value: 'pasted' as const, label: t('resume.ats.pasted') },
    ...(canDrives ? [{ value: 'drive' as const, label: t('resume.ats.drive') }] : []),
  ];
  const todo = live.checks.filter((c) => !c.ok);
  const done = live.checks.filter((c) => c.ok);

  return (
    <section aria-labelledby="ats-title" className="grid gap-4">
      <h2 id="ats-title" className="text-headline font-semibold">
        {t('resume.ats.title')}
      </h2>
      <div className="flex items-center gap-4">
        <ProgressRing
          value={live.score}
          max={100}
          size={88}
          stroke={8}
          label={t('resume.ats.live')}
          valueText={t('resume.ats.score', { n: live.score })}
        >
          <span className="font-display text-title font-bold tabular-nums">{live.score}</span>
        </ProgressRing>
        <div className="grid gap-1">
          <p className="font-semibold">{t('resume.ats.live')}</p>
          <p className="text-callout text-fg-2">{t('resume.ats.liveNote')}</p>
          {report && (
            <p className="text-caption text-fg-3">
              {t('resume.ats.last', {
                n: report.score,
                when: formatRelative(report.checkedAt),
                pages: t('resume.ats.pages', { count: report.pages }),
              })}
              {report.version !== r.version && <> · {t('resume.ats.stale')}</>}
            </p>
          )}
        </div>
      </div>

      {!!todo.length && (
        <ListSection title={t('resume.ats.toFix')} level={3}>
          {todo.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-3">
              <X className="mt-0.5 size-5 flex-none text-warning-ink" aria-hidden />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-medium">
                  <span className="sr-only">{t('resume.ats.failed')}: </span>
                  {t(`resume.ats.check.${c.id}`)}
                </span>
                <span className="text-callout text-pretty text-fg-2">{t(`resume.ats.fix.${c.id}`)}</span>
              </span>
              <Badge tone="success" aria-label={t('resume.ats.pointsLabel', { count: c.points })}>
                {t('resume.ats.points', { n: c.points })}
              </Badge>
            </li>
          ))}
        </ListSection>
      )}
      <ListSection title={t('resume.ats.passedTitle')} level={3}>
        {done.map((c) => (
          <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
            <Check className="mt-0.5 size-5 flex-none text-success-ink" aria-hidden />
            <span className="text-callout">
              <span className="sr-only">{t('resume.ats.passed')}: </span>
              {t(`resume.ats.check.${c.id}`)}
            </span>
          </li>
        ))}
      </ListSection>

      {report?.keywords && (
        <div className="grid gap-3">
          <h3 className="font-semibold">
            {t(report.keywords.source === 'drive' ? 'resume.ats.keywordsDrive' : 'resume.ats.keywordsPasted')}
          </h3>
          {!!live.matched.length && (
            <div className="grid gap-1.5">
              <p className="text-caption text-fg-3">{t('resume.ats.matched')}</p>
              <ul className="flex flex-wrap gap-1.5">
                {live.matched.map((k) => (
                  <li key={k}>
                    <Badge tone="success">{k}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!live.missing.length && (
            <div className="grid gap-1.5">
              <p className="text-caption text-fg-3">{t('resume.ats.missing')}</p>
              <ul className="flex flex-wrap gap-1.5">
                {live.missing.map((k) => (
                  <li key={k}>
                    <Badge tone="neutral">{k}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-caption text-fg-3">{t('resume.ats.disclaimer')}</p>
        </div>
      )}
      {!!report?.gaps.length && (
        <div className="grid gap-1.5">
          <h3 className="font-semibold">{t('resume.ats.gaps')}</h3>
          <ul className="grid list-disc gap-1 pl-5 text-callout">
            {report.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 border-t border-line pt-4">
        <p className="text-callout text-fg-2">{t('resume.ats.intro')}</p>
        <ChoiceGroup
          label={t('resume.ats.against')}
          variant="chip"
          value={against}
          options={choices}
          onChange={setAgainst}
        />
        {against === 'pasted' && (
          <Field label={t('resume.ats.jd')} hint={t('resume.ats.jdHint')}>
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                rows={6}
                maxLength={6000}
                value={jd}
                onChange={(e) => setJd(e.target.value)}
              />
            )}
          </Field>
        )}
        {against === 'drive' && (
          <Field label={t('resume.ats.pickDrive')}>
            {({ id }) => (
              <Select id={id} value={driveId} onChange={(e) => setDriveId(e.target.value)}>
                <option value="">{drives.isLoading ? t('common.loading') : t('placements.choose')}</option>
                {(drives.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.company.name} · {d.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            loading={check.isPending}
            disabled={!ready}
            onClick={() => check.mutate()}
          >
            <ScanText className="size-4" aria-hidden /> {t('resume.ats.run')}
          </Button>
          {dirty && <span className="text-callout text-fg-2">{t('resume.ats.saveFirst')}</span>}
        </div>
        {error && (
          <p role="alert" className="text-callout font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
