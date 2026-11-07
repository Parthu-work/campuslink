import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ScanText, X } from 'lucide-react';
import type { AtsReport, ResumeView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Field, Select, Textarea } from '../../components/ui/field';
import { Badge, Card } from '../../components/ui/misc';
import { ProgressRing } from '../../components/ui/progress';
import { api, ApiError } from '../../lib/api';
import { useCan } from '../../lib/me';
import { formatRelative } from '../../lib/format';
import * as q from '../../lib/queries';

type Against = 'none' | 'pasted' | 'drive';

/**
 * The ATS check (prompt 2, G2): how cleanly the PDF parses, and which of a role's keywords the
 * résumé shows. A guide to a readable résumé, never a claim about any employer's system.
 */
export function AtsPanel({ resume: r, dirty }: { resume: ResumeView; dirty: boolean }) {
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
  const ready = against === 'none' || (against === 'pasted' ? jd.trim().length >= 30 : !!driveId);
  const choices = [
    { value: 'none' as const, label: t('resume.ats.none') },
    { value: 'pasted' as const, label: t('resume.ats.pasted') },
    ...(canDrives ? [{ value: 'drive' as const, label: t('resume.ats.drive') }] : []),
  ];

  return (
    <section aria-labelledby="ats-title" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="ats-title" className="text-headline font-semibold">
          {t('resume.ats.title')}
        </h2>
        <p className="max-w-[60ch] text-callout text-fg-2">{t('resume.ats.intro')}</p>
      </div>
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
        <Button variant="primary" loading={check.isPending} disabled={!ready} onClick={() => check.mutate()}>
          <ScanText className="size-4" aria-hidden /> {t('resume.ats.run')}
        </Button>
        {dirty && <span className="text-callout text-fg-2">{t('resume.ats.saveFirst')}</span>}
      </div>
      {error && (
        <p role="alert" className="text-callout font-medium text-danger">
          {error}
        </p>
      )}
      {report && <AtsResult report={report} current={report.version === r.version} />}
    </section>
  );
}

function AtsResult({ report: a, current }: { report: AtsReport; current: boolean }) {
  const { t } = useTranslation();
  return (
    <Card variant="raised" className="grid gap-4 p-4" aria-live="polite">
      <div className="flex items-center gap-4">
        <ProgressRing value={a.score} max={100} label={t('resume.ats.scoreLabel', { n: a.score })} />
        <div className="grid gap-1">
          <p className="text-headline font-semibold tabular-nums">{t('resume.ats.score', { n: a.score })}</p>
          <p className="text-callout text-fg-2">
            {t('resume.ats.checked', { when: formatRelative(a.checkedAt) })}
            {' · '}
            {t('resume.ats.pages', { count: a.pages })}
          </p>
          {!current && <Badge tone="warning">{t('resume.ats.stale')}</Badge>}
        </div>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {a.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-callout">
            {c.ok ? (
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            ) : (
              <X className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            )}
            <span>
              <span className="sr-only">{c.ok ? t('resume.ats.passed') : t('resume.ats.failed')}: </span>
              {t(`resume.ats.check.${c.id}`)}
            </span>
          </li>
        ))}
      </ul>
      {a.keywords && (
        <div className="grid gap-3">
          <h3 className="font-semibold">
            {t(a.keywords.source === 'drive' ? 'resume.ats.keywordsDrive' : 'resume.ats.keywordsPasted')}
          </h3>
          {!!a.keywords.matched.length && (
            <div className="grid gap-1.5">
              <p className="text-caption text-fg-3">{t('resume.ats.matched')}</p>
              <ul className="flex flex-wrap gap-1.5">
                {a.keywords.matched.map((k) => (
                  <li key={k}>
                    <Badge tone="success">{k}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!a.keywords.missing.length && (
            <div className="grid gap-1.5">
              <p className="text-caption text-fg-3">{t('resume.ats.missing')}</p>
              <ul className="flex flex-wrap gap-1.5">
                {a.keywords.missing.map((k) => (
                  <li key={k}>
                    <Badge tone="neutral">{k}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {!!a.gaps.length && (
        <div className="grid gap-1.5">
          <h3 className="font-semibold">{t('resume.ats.gaps')}</h3>
          <ul className="grid list-disc gap-1 pl-5 text-callout">
            {a.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-caption text-fg-3">{t('resume.ats.disclaimer')}</p>
    </Card>
  );
}
