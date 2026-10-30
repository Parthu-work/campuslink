import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  BRANCHES,
  DRIVE_MODES,
  DRIVE_ROLE_TYPES,
  QUESTION_KINDS,
  ROUND_KINDS,
  driveBody,
  driveUpdateBody,
  type DriveMode,
  type DriveRoleType,
  type DriveView,
  type QuestionKind,
  type RoundKind,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { FormFooter } from '../../components/ui/form-footer';
import { Card, Chip, Skeleton } from '../../components/ui/misc';
import { Switch } from '../../components/ui/switch';
import { api, ApiError } from '../../lib/api';
import { fromLocalInput, toLocalInput } from '../../lib/events';
import { newIdempotencyKey } from '../../lib/format';
import { DRIVE_KEYS } from '../../lib/placements';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

interface RoleForm {
  title: string;
  min: string;
  max: string;
  location: string;
  type: DriveRoleType;
}
interface QuestionForm {
  label: string;
  kind: QuestionKind;
  options: string;
  required: boolean;
}
interface RoundForm {
  name: string;
  kind: RoundKind;
  at: string;
}
interface Form {
  companyName: string;
  title: string;
  description: string;
  mode: DriveMode;
  venue: string;
  driveDate: string;
  registrationCloseAt: string;
  branches: string[];
  gradYears: number[];
  minCgpa: string;
  maxActiveBacklogs: string;
  maxHistoryBacklogs: string;
  minTenthPct: string;
  minTwelfthPct: string;
  roles: RoleForm[];
  questions: QuestionForm[];
  rounds: RoundForm[];
  resumeRequired: boolean;
  createEvent: boolean;
}
type Criterion = 'minCgpa' | 'maxActiveBacklogs' | 'maxHistoryBacklogs' | 'minTenthPct' | 'minTwelfthPct';
const CRITERIA: readonly Criterion[] = [
  'minCgpa',
  'maxActiveBacklogs',
  'maxHistoryBacklogs',
  'minTenthPct',
  'minTwelfthPct',
];

const num = (v: string) => (v.trim() === '' ? null : Number(v));
const str = (v: number | null) => (v === null ? '' : String(v));
const blankRole = (): RoleForm => ({ title: '', min: '', max: '', location: '', type: 'full_time' });

function initial(d?: DriveView): Form {
  if (!d)
    return {
      companyName: '',
      title: '',
      description: '',
      mode: 'on_campus',
      venue: '',
      driveDate: '',
      registrationCloseAt: '',
      branches: [],
      gradYears: [],
      minCgpa: '',
      maxActiveBacklogs: '',
      maxHistoryBacklogs: '',
      minTenthPct: '',
      minTwelfthPct: '',
      roles: [blankRole()],
      questions: [],
      rounds: [],
      resumeRequired: true,
      createEvent: true,
    };
  const e = d.eligibility;
  return {
    companyName: d.company.name,
    title: d.title,
    description: d.description,
    mode: d.mode,
    venue: d.venue,
    driveDate: toLocalInput(d.driveDate),
    registrationCloseAt: toLocalInput(d.registrationCloseAt),
    branches: [...e.branches],
    gradYears: [...e.gradYears],
    minCgpa: str(e.minCgpa),
    maxActiveBacklogs: str(e.maxActiveBacklogs),
    maxHistoryBacklogs: str(e.maxHistoryBacklogs),
    minTenthPct: str(e.minTenthPct),
    minTwelfthPct: str(e.minTwelfthPct),
    roles: d.roles.map((r) => ({
      title: r.title,
      min: str(r.ctcMinLpa),
      max: str(r.ctcMaxLpa),
      location: r.location,
      type: r.type,
    })),
    questions: d.questions.map((x) => ({ ...x, options: x.options.join(', ') })),
    rounds: d.rounds.map((r) => ({ name: r.name, kind: r.kind, at: r.at ? toLocalInput(r.at) : '' })),
    resumeRequired: d.resumeRequired,
    createEvent: false,
  };
}

function payloadOf(f: Form) {
  return {
    companyName: f.companyName.trim(),
    title: f.title,
    description: f.description,
    roles: f.roles.map((r) => ({
      title: r.title,
      ctcMinLpa: num(r.min),
      ctcMaxLpa: num(r.max),
      location: r.location,
      type: r.type,
    })),
    mode: f.mode,
    venue: f.venue,
    driveDate: fromLocalInput(f.driveDate),
    registrationCloseAt: fromLocalInput(f.registrationCloseAt),
    eligibility: {
      branches: f.branches,
      gradYears: f.gradYears,
      minCgpa: num(f.minCgpa),
      maxActiveBacklogs: num(f.maxActiveBacklogs),
      maxHistoryBacklogs: num(f.maxHistoryBacklogs),
      minTenthPct: num(f.minTenthPct),
      minTwelfthPct: num(f.minTwelfthPct),
    },
    questions: f.questions.map((x) => ({
      label: x.label,
      kind: x.kind,
      options:
        x.kind === 'choice'
          ? x.options
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean)
          : [],
      required: x.required,
    })),
    rounds: f.rounds.map((r) => ({ name: r.name, kind: r.kind, at: r.at ? fromLocalInput(r.at) : null })),
    resumeRequired: f.resumeRequired,
  };
}

/** Create or edit a drive: company, roles and pay, who may apply, questions and rounds. */
function DriveForm({ existing }: { existing?: DriveView }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [key] = useState(newIdempotencyKey);
  const [f, setF] = useState<Form>(() => initial(existing));
  const [busy, setBusy] = useState(false);
  const companies = useQuery(q.placementCompanies());
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const setRow = <K extends 'roles' | 'questions' | 'rounds'>(
    k: K,
    i: number,
    patch: Partial<Form[K][number]>,
  ) => setF((x) => ({ ...x, [k]: x[k].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const dropRow = (k: 'roles' | 'questions' | 'rounds', i: number) =>
    setF((x) => ({ ...x, [k]: x[k].filter((_, j) => j !== i) }));
  const payload = payloadOf(f);
  const parsed = existing
    ? driveUpdateBody.safeParse(payload)
    : driveBody.safeParse({ ...payload, createEvent: f.createEvent });
  const issues = parsed.success ? [] : [...new Set(parsed.error.issues.map((i) => i.message))].slice(0, 4);
  const year = new Date().getFullYear();
  const years = [year, year + 1, year + 2, year + 3];
  const save = async () => {
    if (!parsed.success) return;
    setBusy(true);
    try {
      const view = existing
        ? await api.put<DriveView>(`/admin/placements/drives/${existing.id}`, payload)
        : await api.postOnce<DriveView>(
            '/admin/placements/drives',
            { ...payload, createEvent: f.createEvent },
            key,
          );
      qc.setQueryData(['placement-drive', view.id], view);
      for (const queryKey of DRIVE_KEYS) void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ['placement-companies'] });
      toast.success(existing ? t('placements.admin.saved') : t('placements.admin.created'));
      navigate(`/admin/placements/${view.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="grid max-w-3xl gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <BackLink to={existing ? `/admin/placements/${existing.id}` : '/admin/placements'}>
        {existing ? t('placements.admin.backToDrive') : t('placements.admin.backToDrives')}
      </BackLink>
      <h2 className="text-title font-semibold">
        {existing ? t('placements.admin.editTitle') : t('placements.admin.newTitle')}
      </h2>
      <Card className="grid gap-4 p-5">
        <Field label={t('placements.field.company')} hint={t('placements.admin.companyHint')}>
          {({ id, describedBy }) => (
            <>
              <Input
                id={id}
                aria-describedby={describedBy}
                list="placement-companies"
                maxLength={120}
                value={f.companyName}
                onChange={(e) => set('companyName', e.target.value)}
              />
              <datalist id="placement-companies">
                {companies.data?.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label={t('placements.admin.driveTitle')}>
          {({ id }) => (
            <Input id={id} maxLength={160} value={f.title} onChange={(e) => set('title', e.target.value)} />
          )}
        </Field>
        <Field label={t('placements.about')} aside={t('common.optional')}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={4}
              maxLength={4000}
              value={f.description}
              onChange={(e) => set('description', e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('placements.admin.mode')}>
            {({ id }) => (
              <Select id={id} value={f.mode} onChange={(e) => set('mode', e.target.value as DriveMode)}>
                {DRIVE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`placements.mode.${m}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('placements.admin.venue')} aside={t('common.optional')}>
            {({ id }) => (
              <Input id={id} maxLength={200} value={f.venue} onChange={(e) => set('venue', e.target.value)} />
            )}
          </Field>
          <Field label={t('placements.admin.driveDate')}>
            {({ id }) => (
              <Input
                id={id}
                type="datetime-local"
                value={f.driveDate}
                onChange={(e) => set('driveDate', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('placements.admin.closeAt')}>
            {({ id }) => (
              <Input
                id={id}
                type="datetime-local"
                value={f.registrationCloseAt}
                onChange={(e) => set('registrationCloseAt', e.target.value)}
              />
            )}
          </Field>
        </div>
      </Card>

      <section aria-labelledby="ed-roles" className="grid gap-3">
        <h3 id="ed-roles" className="font-semibold">
          {t('placements.roles')}
        </h3>
        {f.roles.map((r, i) => (
          <Card key={i} className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label={t('placements.field.role')}>
              {({ id }) => (
                <Input
                  id={id}
                  maxLength={120}
                  value={r.title}
                  onChange={(e) => setRow('roles', i, { title: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('placements.field.roleType')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={r.type}
                  onChange={(e) => setRow('roles', i, { type: e.target.value as DriveRoleType })}
                >
                  {DRIVE_ROLE_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {t(`placements.roleType.${x}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('placements.admin.ctcMin')} aside={t('common.optional')}>
              {({ id }) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={r.min}
                  onChange={(e) => setRow('roles', i, { min: e.target.value.replace(/[^\d.]/g, '') })}
                />
              )}
            </Field>
            <Field label={t('placements.admin.ctcMax')} aside={t('common.optional')}>
              {({ id }) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={r.max}
                  onChange={(e) => setRow('roles', i, { max: e.target.value.replace(/[^\d.]/g, '') })}
                />
              )}
            </Field>
            <Field label={t('placements.admin.location')} aside={t('common.optional')}>
              {({ id }) => (
                <Input
                  id={id}
                  maxLength={120}
                  value={r.location}
                  onChange={(e) => setRow('roles', i, { location: e.target.value })}
                />
              )}
            </Field>
            {f.roles.length > 1 && (
              <div className="self-end">
                <Button size="sm" variant="ghost" onClick={() => dropRow('roles', i)}>
                  <Trash2 className="size-4" aria-hidden /> {t('placements.admin.removeRole')}
                </Button>
              </div>
            )}
          </Card>
        ))}
        {f.roles.length < 10 && (
          <div>
            <Button size="sm" onClick={() => set('roles', [...f.roles, blankRole()])}>
              <Plus className="size-4" aria-hidden /> {t('placements.admin.addRole')}
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="ed-elig" className="grid gap-3">
        <h3 id="ed-elig" className="font-semibold">
          {t('placements.criteria')}
        </h3>
        <p className="text-meta text-fg-2">{t('placements.admin.criteriaIntro')}</p>
        <Card className="grid gap-4 p-4">
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-meta font-semibold">{t('placements.admin.branches')}</legend>
            <div className="flex flex-wrap gap-2">
              {BRANCHES.map((b) => (
                <Chip
                  key={b}
                  pressed={f.branches.includes(b)}
                  onClick={() =>
                    set(
                      'branches',
                      f.branches.includes(b) ? f.branches.filter((x) => x !== b) : [...f.branches, b],
                    )
                  }
                >
                  {b}
                </Chip>
              ))}
            </div>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-meta font-semibold">{t('placements.admin.gradYears')}</legend>
            <div className="flex flex-wrap gap-2">
              {years.map((y) => (
                <Chip
                  key={y}
                  pressed={f.gradYears.includes(y)}
                  onClick={() =>
                    set(
                      'gradYears',
                      f.gradYears.includes(y) ? f.gradYears.filter((x) => x !== y) : [...f.gradYears, y],
                    )
                  }
                >
                  {y}
                </Chip>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            {CRITERIA.map((c) => (
              <Field key={c} label={t(`placements.admin.crit.${c}`)} aside={t('common.optional')}>
                {({ id }) => (
                  <Input
                    id={id}
                    inputMode={c.startsWith('max') ? 'numeric' : 'decimal'}
                    value={f[c]}
                    onChange={(e) => set(c, e.target.value.replace(/[^\d.]/g, ''))}
                  />
                )}
              </Field>
            ))}
          </div>
        </Card>
      </section>

      <section aria-labelledby="ed-questions" className="grid gap-3">
        <h3 id="ed-questions" className="font-semibold">
          {t('placements.admin.questions')}
        </h3>
        <Card className="grid gap-3 p-4">
          <Switch
            checked={f.resumeRequired}
            onChange={(v) => set('resumeRequired', v)}
            label={t('placements.admin.resumeRequired')}
            description={t('placements.admin.resumeRequiredHint')}
          />
        </Card>
        {f.questions.map((x, i) => (
          <Card key={i} className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label={t('placements.admin.question')}>
              {({ id }) => (
                <Input
                  id={id}
                  maxLength={200}
                  value={x.label}
                  onChange={(e) => setRow('questions', i, { label: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('placements.admin.questionKind')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={x.kind}
                  onChange={(e) => setRow('questions', i, { kind: e.target.value as QuestionKind })}
                >
                  {QUESTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`placements.admin.kind.${k}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {x.kind === 'choice' && (
              <Field label={t('placements.admin.options')} hint={t('placements.admin.optionsHint')}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={x.options}
                    onChange={(e) => setRow('questions', i, { options: e.target.value })}
                  />
                )}
              </Field>
            )}
            <Switch
              checked={x.required}
              onChange={(v) => setRow('questions', i, { required: v })}
              label={t('placements.admin.required')}
            />
            <div>
              <Button size="sm" variant="ghost" onClick={() => dropRow('questions', i)}>
                <Trash2 className="size-4" aria-hidden /> {t('placements.admin.removeQuestion')}
              </Button>
            </div>
          </Card>
        ))}
        {f.questions.length < 10 && (
          <div>
            <Button
              size="sm"
              onClick={() =>
                set('questions', [...f.questions, { label: '', kind: 'text', options: '', required: true }])
              }
            >
              <Plus className="size-4" aria-hidden /> {t('placements.admin.addQuestion')}
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="ed-rounds" className="grid gap-3">
        <h3 id="ed-rounds" className="font-semibold">
          {t('placements.rounds')}
        </h3>
        {f.rounds.map((r, i) => (
          <Card key={i} className="grid gap-3 p-4 sm:grid-cols-3">
            <Field label={t('placements.admin.roundName')}>
              {({ id }) => (
                <Input
                  id={id}
                  maxLength={80}
                  value={r.name}
                  onChange={(e) => setRow('rounds', i, { name: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('placements.admin.roundKind')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={r.kind}
                  onChange={(e) => setRow('rounds', i, { kind: e.target.value as RoundKind })}
                >
                  {ROUND_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`placements.roundKind.${k}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('placements.admin.roundAt')} aside={t('common.optional')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="datetime-local"
                  value={r.at}
                  onChange={(e) => setRow('rounds', i, { at: e.target.value })}
                />
              )}
            </Field>
            <div>
              <Button size="sm" variant="ghost" onClick={() => dropRow('rounds', i)}>
                <Trash2 className="size-4" aria-hidden /> {t('placements.admin.removeRound')}
              </Button>
            </div>
          </Card>
        ))}
        {f.rounds.length < 10 && (
          <div>
            <Button
              size="sm"
              onClick={() => set('rounds', [...f.rounds, { name: '', kind: 'aptitude', at: '' }])}
            >
              <Plus className="size-4" aria-hidden /> {t('placements.admin.addRound')}
            </Button>
          </div>
        )}
      </section>

      {!existing && (
        <Card className="p-4">
          <Switch
            checked={f.createEvent}
            onChange={(v) => set('createEvent', v)}
            label={t('placements.admin.createEvent')}
            description={t('placements.admin.createEventHint')}
          />
        </Card>
      )}
      <FormFooter>
        {issues.length > 0 && (
          <ul className="mr-auto grid gap-0.5 text-caption text-fg-2" aria-live="polite">
            {issues.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        <Button variant="primary" type="submit" loading={busy} disabled={!parsed.success}>
          {existing ? t('placements.admin.save') : t('placements.admin.createDraft')}
        </Button>
      </FormFooter>
    </form>
  );
}

/** Admin › Placements › New drive. */
export function DriveEditor() {
  return <DriveForm />;
}

/** Admin › Placements › a drive › Edit (before it starts). */
export function DriveEditPage() {
  const { id = '' } = useParams();
  const d = useQuery({ ...SCREEN, ...q.placementDrive(id) });
  if (d.isLoading) return <Skeleton className="h-96" />;
  if (d.isError) return <ErrorState error={d.error} onRetry={() => void d.refetch()} />;
  return d.data ? <DriveForm key={d.data.id} existing={d.data} /> : null;
}
