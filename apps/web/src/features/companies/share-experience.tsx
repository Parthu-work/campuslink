import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PenLine, Plus, Trash2 } from 'lucide-react';
import {
  EXPERIENCE_DIFFICULTIES,
  EXPERIENCE_QUESTIONS_MAX,
  EXPERIENCE_RESULTS,
  EXPERIENCE_ROUNDS_MAX,
  ROUND_KINDS,
  type ExperienceDifficulty,
  type ExperienceResult,
  type ExperienceView,
  type RoundKind,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { FormFooter } from '../../components/ui/form-footer';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { Switch } from '../../components/ui/switch';
import { api, ApiError } from '../../lib/api';
import { useDraft } from '../../lib/drafts';
import { newIdempotencyKey } from '../../lib/format';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import { ExperienceCard } from './experience-card';
import { myExperiences } from './experience-queries';

interface RoundDraft {
  kind: RoundKind;
  name: string;
  questions: string[];
  notes: string;
}
const emptyRound = (kind: RoundKind = 'technical'): RoundDraft => ({
  kind,
  name: '',
  questions: [''],
  notes: '',
});

/** Share an interview experience (prompt 2, G10): reviewed before juniors read it. */
export function ShareExperiencePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mine = useQuery({ ...SCREEN, ...myExperiences() });
  const [picked, setPicked] = useState(params.get('company') ?? '');
  const [other, setOther] = useState('');
  const [role, setRole] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [difficulty, setDifficulty] = useState<ExperienceDifficulty>('medium');
  const [result, setResult] = useState<ExperienceResult>('selected');
  const [rounds, setRounds] = useState<RoundDraft[]>([emptyRound('aptitude'), emptyRound('technical')]);
  const [tips, setTips] = useDraft('experience-tips');
  const [named, setNamed] = useState(true);
  const [key] = useState(newIdempotencyKey);
  const allowed = mine.data?.companies ?? [];
  const company = allowed.find((c) => c.key === picked)?.name ?? (mine.data?.anyCompany ? other.trim() : '');
  const setRound = (i: number, patch: Partial<RoundDraft>) =>
    setRounds((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const body = {
    company,
    role: role.trim(),
    year: Number(year),
    rounds: rounds.map((r) => ({
      kind: r.kind,
      name: r.name.trim(),
      questions: r.questions.map((x) => x.trim()).filter((x) => x.length >= 5),
      notes: r.notes.trim(),
    })),
    tips: tips.trim(),
    difficulty,
    result,
    named,
  };
  const ready = company.length >= 2 && body.role.length >= 2 && /^\d{4}$/.test(year) && rounds.length > 0;
  const send = useMutation({
    mutationFn: () => api.postOnce<ExperienceView>('/me/experiences', body, key),
    onSuccess: () => {
      setTips('');
      void qc.invalidateQueries({ queryKey: ['experiences'] });
      toast.success(t('moat.form.sent'));
      void navigate('/experiences');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });

  if (mine.isLoading) return <Skeleton className="mx-auto h-96 w-full max-w-[760px]" />;
  if (mine.isError) return <ErrorState error={mine.error} onRetry={() => void mine.refetch()} />;
  const canWrite = !!allowed.length || !!mine.data?.anyCompany;
  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-5">
      <BackLink to="/companies">{t('nav.companies')}</BackLink>
      <PageHeader icon={<PenLine />} title={t('moat.form.title')} intro={t('moat.form.intro')} />
      {!canWrite ? (
        <EmptyState art={<Illustration kind="empty" />} title={t('moat.form.cannot')} />
      ) : (
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) send.mutate();
          }}
        >
          <p className="rounded-[var(--radius-md)] bg-warning-surface p-3 text-meta text-warning-ink">
            {t('moat.form.careful')}
          </p>
          <Field
            label={t('moat.form.company')}
            hint={mine.data?.anyCompany ? t('moat.form.anyHint') : t('moat.form.companyHint')}
          >
            {({ id, describedBy }) =>
              allowed.length && !mine.data?.anyCompany ? (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                >
                  <option value="">{t('moat.form.pick')}</option>
                  {allowed.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  maxLength={120}
                  value={other || allowed.find((c) => c.key === picked)?.name || ''}
                  onChange={(e) => {
                    setPicked('');
                    setOther(e.target.value);
                  }}
                />
              )
            }
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('moat.form.role')}>
              {({ id }) => (
                <Input id={id} maxLength={120} value={role} onChange={(e) => setRole(e.target.value)} />
              )}
            </Field>
            <Field label={t('moat.form.year')}>
              {({ id }) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  maxLength={4}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="grid gap-2">
            <p className="text-meta font-semibold">{t('moat.form.difficulty')}</p>
            <ChoiceGroup<ExperienceDifficulty>
              label={t('moat.form.difficulty')}
              variant="chip"
              value={difficulty}
              onChange={setDifficulty}
              options={EXPERIENCE_DIFFICULTIES.map((d) => ({ value: d, label: t(`moat.difficulty.${d}`) }))}
            />
          </div>
          <div className="grid gap-2">
            <p className="text-meta font-semibold">{t('moat.form.result')}</p>
            <ChoiceGroup<ExperienceResult>
              label={t('moat.form.result')}
              variant="chip"
              value={result}
              onChange={setResult}
              options={EXPERIENCE_RESULTS.map((r) => ({ value: r, label: t(`moat.result.${r}`) }))}
            />
          </div>
          <fieldset className="grid gap-3">
            <legend className="mb-2 text-title font-semibold">{t('moat.form.rounds')}</legend>
            {rounds.map((r, i) => (
              <Card key={i} className="grid gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{t('moat.form.round', { n: i + 1 })}</p>
                  {rounds.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('moat.form.removeRound', { n: i + 1 })}
                      onClick={() => setRounds((rs) => rs.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('moat.form.kind')}>
                    {({ id }) => (
                      <Select
                        id={id}
                        value={r.kind}
                        onChange={(e) => setRound(i, { kind: e.target.value as RoundKind })}
                      >
                        {ROUND_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {t(`placements.roundKind.${k}`)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label={t('moat.form.roundName')}>
                    {({ id }) => (
                      <Input
                        id={id}
                        maxLength={60}
                        value={r.name}
                        onChange={(e) => setRound(i, { name: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
                {r.questions.map((qText, qi) => (
                  <div key={qi} className="flex items-end gap-2">
                    <div className="flex-1">
                      <Field label={t('moat.form.question', { n: qi + 1 })}>
                        {({ id }) => (
                          <Textarea
                            id={id}
                            rows={2}
                            maxLength={400}
                            value={qText}
                            onChange={(e) =>
                              setRound(i, {
                                questions: r.questions.map((x, k) => (k === qi ? e.target.value : x)),
                              })
                            }
                          />
                        )}
                      </Field>
                    </div>
                    {r.questions.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('moat.form.removeQuestion', { n: qi + 1 })}
                        onClick={() => setRound(i, { questions: r.questions.filter((_, k) => k !== qi) })}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    )}
                  </div>
                ))}
                {r.questions.length < EXPERIENCE_QUESTIONS_MAX && (
                  <Button
                    variant="ghost"
                    className="justify-self-start"
                    onClick={() => setRound(i, { questions: [...r.questions, ''] })}
                  >
                    <Plus className="size-4" aria-hidden /> {t('moat.form.addQuestion')}
                  </Button>
                )}
                <Field label={t('moat.form.notes')}>
                  {({ id }) => (
                    <Textarea
                      id={id}
                      rows={2}
                      maxLength={1000}
                      value={r.notes}
                      onChange={(e) => setRound(i, { notes: e.target.value })}
                    />
                  )}
                </Field>
              </Card>
            ))}
            {rounds.length < EXPERIENCE_ROUNDS_MAX && (
              <Button
                variant="secondary"
                className="justify-self-start"
                onClick={() => setRounds((rs) => [...rs, emptyRound()])}
              >
                <Plus className="size-4" aria-hidden /> {t('moat.form.addRound')}
              </Button>
            )}
          </fieldset>
          <Field label={t('moat.form.tips')}>
            {({ id }) => (
              <Textarea
                id={id}
                rows={4}
                maxLength={2000}
                value={tips}
                onChange={(e) => setTips(e.target.value)}
              />
            )}
          </Field>
          <Switch
            checked={named}
            onChange={setNamed}
            label={t('moat.form.named')}
            description={t('moat.form.namedHint')}
          />
          <FormFooter>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={!ready} loading={send.isPending}>
                {t('moat.form.submit')}
              </Button>
            </div>
          </FormFooter>
        </form>
      )}
    </div>
  );
}

/** The member's own write-ups with their review status (prompt 2, G10). */
export function MyExperiencesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const mine = useQuery({ ...SCREEN, ...myExperiences() });
  const withdraw = useMutation({
    mutationFn: (id: string) => api.delete(`/me/experiences/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['experiences'] });
      toast.success(t('moat.withdrawn'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <div className="mx-auto grid w-full max-w-[860px] gap-5">
      <BackLink to="/companies">{t('nav.companies')}</BackLink>
      <PageHeader
        icon={<PenLine />}
        title={t('moat.mineTitle')}
        actions={
          <Link to="/experiences/new" className={buttonVariants({ variant: 'primary' })}>
            {t('moat.share')}
          </Link>
        }
      />
      {mine.isLoading && <Skeleton className="h-48" />}
      {mine.isError && <ErrorState error={mine.error} onRetry={() => void mine.refetch()} />}
      {mine.data && !mine.data.items.length && (
        <EmptyState art={<Illustration kind="empty" />} title={t('moat.mineNone')} />
      )}
      {!!mine.data?.items.length && (
        <ul className="grid gap-3">
          {mine.data.items.map((e) => (
            <li key={e.id}>
              <ExperienceCard
                e={e}
                actions={
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="grid gap-1">
                      <Badge
                        tone={
                          e.removed
                            ? 'danger'
                            : e.status === 'published'
                              ? 'success'
                              : e.status === 'rejected'
                                ? 'warning'
                                : 'info'
                        }
                      >
                        {t(`moat.status.${e.removed ? 'removed' : e.status}`)}
                      </Badge>
                      {e.reason && (
                        <p className="text-meta text-fg-2">{t('moat.note', { reason: e.reason })}</p>
                      )}
                    </div>
                    {e.status !== 'published' && (
                      <Button
                        variant="ghost"
                        loading={withdraw.isPending && withdraw.variables === e.id}
                        onClick={() => withdraw.mutate(e.id)}
                      >
                        {t('moat.withdraw')}
                      </Button>
                    )}
                  </div>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
