import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mic, PlayCircle } from 'lucide-react';
import {
  BRANCHES,
  INTERVIEW_DIFFICULTIES,
  INTERVIEW_LANGUAGES,
  INTERVIEW_QUESTIONS_MAX,
  INTERVIEW_QUESTIONS_MIN,
  RUBRIC_DIMENSIONS,
  type Branch,
  type InterviewDifficulty,
  type InterviewHistoryView,
  type InterviewLanguage,
  type InterviewMode,
  type InterviewTrack,
  type InterviewView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Select } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Illustration } from '../../components/ui/illustration';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Table, Td, TdNum, Th, THead } from '../../components/ui/table';
import { api, ApiError } from '../../lib/api';
import { formatDay, newIdempotencyKey } from '../../lib/format';
import { useCan } from '../../lib/me';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { recordingSupported } from './use-recorder';

/** One decimal, or a dash where the dimension was not scored (correctness on HR). */
const fmt = (n: number | null | undefined) => (typeof n === 'number' ? n.toFixed(1) : '–');

function StartForm({ history }: { history: InterviewHistoryView }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canDrives = useCan('placements:view');
  const [track, setTrack] = useState<InterviewTrack>('hr');
  const [branch, setBranch] = useState<Branch | ''>('');
  const [driveId, setDriveId] = useState('');
  const [difficulty, setDifficulty] = useState<InterviewDifficulty>('medium');
  const [language, setLanguage] = useState<InterviewLanguage>('en');
  const [mode, setMode] = useState<InterviewMode>('text');
  const [count, setCount] = useState(6);
  const [key, setKey] = useState(newIdempotencyKey);
  const [error, setError] = useState('');
  const drives = useQuery({ ...q.placementDrives('eligible'), enabled: canDrives && track === 'drive' });
  const voice = history.voiceAvailable && recordingSupported();
  const left = Math.max(0, history.today.limit - history.today.started);
  const start = useMutation({
    mutationFn: () =>
      api.postOnce<InterviewView>(
        '/interviews',
        {
          track,
          ...(track === 'technical' && branch ? { branch } : {}),
          ...(track === 'drive' ? { driveId } : {}),
          difficulty,
          language,
          mode: voice ? mode : 'text',
          questions: count,
        },
        key,
      ),
    onSuccess: (s) => {
      setKey(newIdempotencyKey());
      qc.setQueryData(q.interview(s.id).queryKey, s);
      void qc.invalidateQueries({ queryKey: ['interviews'] });
      void navigate(`/interviews/${s.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const ready = left > 0 && (track !== 'drive' || !!driveId);
  return (
    <Card variant="raised" className="grid gap-5 p-4 sm:p-6">
      <h2 className="text-title font-semibold">{t('interviews.start.title')}</h2>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-meta font-semibold">{t('interviews.start.track')}</legend>
        <ChoiceGroup
          label={t('interviews.start.track')}
          value={track}
          columns={3}
          options={[
            { value: 'hr', label: t('interviews.track.hr'), detail: t('interviews.trackDetail.hr') },
            {
              value: 'technical',
              label: t('interviews.track.technical'),
              detail: t('interviews.trackDetail.technical'),
            },
            ...(canDrives
              ? [
                  {
                    value: 'drive' as const,
                    label: t('interviews.track.drive'),
                    detail: t('interviews.trackDetail.drive'),
                  },
                ]
              : []),
          ]}
          onChange={setTrack}
        />
      </fieldset>
      {track === 'technical' && (
        <Field label={t('interviews.start.branch')} hint={t('interviews.start.branchHint')}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={branch}
              onChange={(e) => setBranch(e.target.value as Branch | '')}
            >
              <option value="">{t('interviews.start.myBranch')}</option>
              {BRANCHES.filter((b) => b !== 'OTHER').map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {track === 'drive' && (
        <Field label={t('interviews.start.drive')}>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-meta font-semibold">{t('interviews.start.difficulty')}</legend>
          <ChoiceGroup
            label={t('interviews.start.difficulty')}
            variant="chip"
            value={difficulty}
            options={INTERVIEW_DIFFICULTIES.map((v) => ({
              value: v,
              label: t(`interviews.difficulty.${v}`),
            }))}
            onChange={setDifficulty}
          />
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-meta font-semibold">{t('interviews.start.language')}</legend>
          <ChoiceGroup
            label={t('interviews.start.language')}
            variant="chip"
            value={language}
            options={INTERVIEW_LANGUAGES.map((v) => ({ value: v, label: t(`interviews.language.${v}`) }))}
            onChange={setLanguage}
          />
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-meta font-semibold">{t('interviews.start.mode')}</legend>
          <ChoiceGroup
            label={t('interviews.start.mode')}
            variant="chip"
            value={voice ? mode : 'text'}
            options={[
              { value: 'text', label: t('interviews.mode.text') },
              {
                value: 'voice',
                label: t('interviews.mode.voice'),
                icon: <Mic className="size-4" aria-hidden />,
                disabled: !voice,
              },
            ]}
            onChange={setMode}
          />
          {!voice && <p className="text-caption text-fg-3">{t('interviews.start.noVoice')}</p>}
        </fieldset>
        <Field label={t('interviews.start.count')}>
          {({ id }) => (
            <Select id={id} value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
              {Array.from(
                { length: INTERVIEW_QUESTIONS_MAX - INTERVIEW_QUESTIONS_MIN + 1 },
                (_, i) => i + INTERVIEW_QUESTIONS_MIN,
              ).map((n) => (
                <option key={n} value={n}>
                  {t('interviews.start.questions', { count: n })}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {track !== 'hr' && <p className="text-caption text-fg-3">{t('interviews.start.englishTechnical')}</p>}
      {error && (
        <p role="alert" className="text-meta font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          loading={start.isPending}
          disabled={!ready}
          onClick={() => start.mutate()}
        >
          <PlayCircle className="size-5" aria-hidden /> {t('interviews.start.go')}
        </Button>
        <span className="text-meta text-fg-2">
          {left ? t('interviews.start.left', { count: left }) : t('interviews.start.none')}
        </span>
      </div>
      <p className="text-caption text-fg-3">{t('interviews.start.privacy')}</p>
    </Card>
  );
}

function Progress({ history: h }: { history: InterviewHistoryView }) {
  const { t } = useTranslation();
  if (!h.trend.length) return null;
  const latest = h.trend.at(-1)?.averages;
  return (
    <section aria-labelledby="interview-progress" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="interview-progress" className="text-title font-semibold">
          {t('interviews.progress.title')}
        </h2>
        <p className="text-meta text-fg-2">{t('interviews.progress.intro')}</p>
      </div>
      <StatGrid>
        {RUBRIC_DIMENSIONS.map((d) => {
          const series = h.trend.map((p) => p.averages[d]).filter((v): v is number => typeof v === 'number');
          return (
            <StatCard
              key={d}
              label={t(`interviews.dimension.${d}`)}
              value={latest?.[d] != null ? t('interviews.outOf5', { n: fmt(latest[d]) }) : '–'}
              {...(series.length > 1 ? { trend: series } : {})}
            />
          );
        })}
      </StatGrid>
      <Table label={t('interviews.progress.table')}>
        <THead>
          <tr>
            <Th>{t('interviews.progress.date')}</Th>
            {RUBRIC_DIMENSIONS.map((d) => (
              <Th key={d} className="text-right">
                {t(`interviews.dimension.${d}`)}
              </Th>
            ))}
          </tr>
        </THead>
        <tbody>
          {h.trend.map((p) => (
            <tr key={p.at}>
              <Td>{formatDay(p.at)}</Td>
              {RUBRIC_DIMENSIONS.map((d) => (
                <TdNum key={d}>{fmt(p.averages[d])}</TdNum>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

/** Practice interviews (prompt 2, G3): start one, see past ones, and progress per dimension. */
export function InterviewsPage() {
  const { t } = useTranslation();
  const h = useQuery({ ...SCREEN, ...q.interviews() });
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-6">
      <PageHeader icon={<Mic />} title={t('nav.interviews')} intro={t('interviews.intro')} />
      {h.isLoading && <Skeleton className="h-80 rounded-[var(--radius-lg)]" />}
      {h.isError && <ErrorState error={h.error} onRetry={() => void h.refetch()} />}
      {h.data && (
        <>
          <StartForm history={h.data} />
          <Progress history={h.data} />
          <section aria-labelledby="interview-history" className="grid gap-3">
            <h2 id="interview-history" className="text-title font-semibold">
              {t('interviews.history')}
            </h2>
            {!h.data.sessions.length ? (
              <EmptyState art={<Illustration kind="empty" />} title={t('interviews.emptyTitle')}>
                {t('interviews.emptyBody')}
              </EmptyState>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {h.data.sessions.map((s) => (
                  <li key={s.id}>
                    <Card variant="interactive" className="relative grid gap-1 p-4">
                      <Link to={`/interviews/${s.id}`} className="font-semibold after:absolute after:inset-0">
                        {s.company
                          ? t('interviews.forCompany', { company: s.company })
                          : t(`interviews.track.${s.track}`)}
                      </Link>
                      <p className="text-meta text-fg-2">
                        {formatDay(s.createdAt)} · {t(`interviews.difficulty.${s.difficulty}`)}
                      </p>
                      <div>
                        <Badge tone={s.status === 'completed' ? 'success' : 'neutral'}>
                          {t(`interviews.status.${s.status}`)}
                        </Badge>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
