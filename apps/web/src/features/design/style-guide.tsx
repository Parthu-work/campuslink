import { useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from '../../i18n/react';
import { Clock, Compass, Heart, Info, Sparkles } from 'lucide-react';
import { contrastRatio, generatePalette, parseOklch, staticTokens, type Theme } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { AvatarStack } from '../../components/ui/avatar-stack';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Dialog, Sheet } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { Avatar, Badge, Card, Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { ActionCard } from '../../components/ui/action-card';
import { Kbd, SkeletonCard, SkeletonChart, SkeletonRow } from '../../components/ui/skeletons';
import { Countdown } from '../../components/ui/countdown';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { PersonCard } from '../../components/ui/person-card';
import { ScoreRing } from '../../components/ui/score-ring';
import { StepTrack } from '../../components/ui/step-track';
import { Timeline } from '../../components/ui/timeline';
import { Toolbar } from '../../components/ui/toolbar';
import { toast } from '../../lib/toast';
import { formatDay } from '../../lib/format';
import { Illustration, type IllustrationKind } from '../../components/ui/illustration';
import { OtpInput } from '../../components/ui/otp';
import { PageHeader } from '../../components/ui/page-header';
import { ProgressBar, ProgressRing } from '../../components/ui/progress';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { ColumnChart } from '../../components/ui/column-chart';
import { RadarSweep } from '../../components/ui/radar-sweep';
import { RoleChip } from '../../components/ui/role-chip';
import { Stepper } from '../../components/ui/stepper';
import { Switch } from '../../components/ui/switch';
import { Table, THead, Td, TdNum, Th } from '../../components/ui/table';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { Tooltip } from '../../components/ui/tooltip';
import { Segmented } from '../../components/ui/tab-nav';
import { cn } from '../../lib/cn';
import { FormFooter } from '../../components/ui/form-footer';

/**
 * The living style guide (master prompt §12, phase 6): every token and primitive, side by side in
 * both themes, for any college colour. Development builds only (`/design`); it is not part of the
 * app members use, and production builds leave it out.
 */
const COLLEGES = [
  // The two fictional demo colleges from the seed data.
  { id: 'dpit', label: 'DPIT', primary: '#3fb8e6', accent: '#f2b705' },
  { id: 'mrce', label: 'MRCE', primary: '#22b07d', accent: '#ff7a59' },
  // The awkward colours the palette test covers.
  { id: 'maroon', label: '#800000', primary: '#800000', accent: '#f2b705' },
  { id: 'navy', label: '#000080', primary: '#000080', accent: '#ff9933' },
  { id: 'saffron', label: '#ff9933', primary: '#ff9933', accent: '#000080' },
  { id: 'forest', label: '#228b22', primary: '#228b22', accent: '#ffd700' },
  { id: 'lime', label: '#ccff00', primary: '#ccff00', accent: '#ff00ff' },
  { id: 'red', label: '#ff0000', primary: '#ff0000', accent: '#ffffff' },
  { id: 'teal', label: '#008080', primary: '#008080', accent: null },
  { id: 'purple', label: '#800080', primary: '#800080', accent: '#00ffcc' },
] as const;
type CollegeId = (typeof COLLEGES)[number]['id'];

const RAMP = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const STATUS = ['success', 'warning', 'danger', 'info'] as const;
/** Role chip hues (palette.ts) and the role each one labels. */
const ROLES = [
  ['student', 'STUDENT'],
  ['alumni', 'ALUMNI'],
  ['faculty', 'FACULTY'],
  ['admin', 'COLLEGE_ADMIN'],
] as const;
/** ADR 0015's six steps; Display and Title use the display face (screen titles, big numbers). */
const SCALE = ['display', 'title', 'headline', 'body', 'callout', 'caption'] as const;
/** ADR 0015's three radii (the older names map onto them) and the chip pill. */
const RADII = ['sm', 'md', 'xl', 'pill'] as const;
const DISPLAY = new Set<string>(['display', 'title']);
const SPRINGS = ['snappy', 'smooth', 'bouncy'] as const;
const ILLUSTRATIONS: IllustrationKind[] = [
  'empty',
  'search',
  'offline',
  'error',
  'done',
  'people',
  'calendar',
  'study',
];
/** Obviously fictional rows for the table specimen. */
const DEMO_ROWS = [
  ['Demo Member A', 'CSE', 12],
  ['Demo Member B', 'ECE', 7],
  ['Demo Member C', 'MECH', 3],
] as const;

/** Every token for one college, scoped to `[data-palette]` containers so both themes sit side by side. */
function specimenCss(college: (typeof COLLEGES)[number]) {
  const palette = generatePalette({ primary: college.primary, accent: college.accent });
  const fixed = staticTokens();
  const block = (theme: Theme) =>
    `[data-palette='${college.id}'][data-theme='${theme}'] {${Object.entries({
      ...palette[theme],
      ...fixed[theme],
    })
      .map(([k, v]) => `${k}: ${v};`)
      .join(' ')}}`;
  return { css: `${block('light')}\n${block('dark')}`, palette, fixed };
}

function Ratio({
  fg,
  bg,
  onFill = false,
}: {
  fg: string | undefined;
  bg: string | undefined;
  onFill?: boolean;
}) {
  const { t } = useTranslation();
  const a = parseOklch(fg ?? '');
  const b = parseOklch(bg ?? '');
  if (!a || !b) return null;
  return (
    <span className={cn('font-mono text-caption tabular-nums', onFill ? 'text-current' : 'text-fg-3')}>
      {t('design.ratio', { ratio: contrastRatio(a, b).toFixed(1) })}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  );
}

function Swatch({ name, className, children }: { name: string; className?: string; children?: ReactNode }) {
  return (
    <div className="grid gap-1">
      <div
        className={cn(
          'grid h-12 place-items-center rounded-[var(--radius-sm)] border border-line',
          className,
        )}
      >
        {children}
      </div>
      <code className="truncate font-mono text-caption text-fg-3">{name}</code>
    </div>
  );
}

function Specimen({ college, theme }: { college: (typeof COLLEGES)[number]; theme: Theme }) {
  const { t } = useTranslation();
  const { palette, fixed } = useMemo(() => specimenCss(college), [college]);
  const tok = { ...palette[theme], ...fixed[theme] };
  const [segment, setSegment] = useState<'a' | 'b' | 'c'>('a');
  const [chip, setChip] = useState(true);
  const [checked, setChecked] = useState(true);
  const checkId = useId();
  const [otp, setOtp] = useState('2026');
  const [played, setPlayed] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [on, setOn] = useState(true);
  const [choice, setChoice] = useState<'a' | 'b'>('a');
  const [tab, setTab] = useState<'notes' | 'slides' | 'videos'>('notes');
  const tabsId = useId();
  return (
    <div
      data-palette={college.id}
      data-theme={theme}
      className="grid min-w-0 content-start gap-8 rounded-[var(--radius-xl)] border border-line bg-bg p-5 text-fg"
    >
      <h2 className="text-headline font-bold">{t(theme === 'light' ? 'design.light' : 'design.dark')}</h2>

      <Section title={t('design.surfaces')}>
        <div className="grid grid-cols-4 gap-2">
          <Swatch name="bg" className="bg-bg" />
          <Swatch name="surface-1" className="bg-surface-1" />
          <Swatch name="surface-2" className="bg-surface-2" />
          <Swatch name="surface-3" className="bg-surface-3" />
        </div>
        <div className="grid gap-1">
          {(['fg', 'fg-2', 'fg-3'] as const).map((k) => (
            <p key={k} className="flex items-baseline justify-between gap-3" style={{ color: `var(--${k})` }}>
              <span>{t('design.sample')}</span>
              <span className="flex flex-none items-baseline gap-2">
                <code className="font-mono text-caption">{k}</code>
                <Ratio fg={tok[`--${k}`]} bg={tok['--surface-2']} />
              </span>
            </p>
          ))}
        </div>
      </Section>

      <Section title={t('design.brand')}>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1 rounded-[var(--radius-md)] bg-brand p-3 text-on-brand">
            <b>brand / on-brand</b>
            <Ratio fg={tok['--on-brand']} bg={tok['--brand']} onFill />
          </div>
          <div className="grid gap-1 rounded-[var(--radius-md)] bg-accent p-3 text-on-accent">
            <b>accent / on-accent</b>
            <Ratio fg={tok['--on-accent']} bg={tok['--accent']} onFill />
          </div>
        </div>
        <p className="flex justify-between text-brand-ink">
          <b>brand-ink</b> <Ratio fg={tok['--brand-ink']} bg={tok['--surface-2']} />
        </p>
        <p className="flex justify-between text-accent-ink">
          <b>accent-ink</b> <Ratio fg={tok['--accent-ink']} bg={tok['--surface-2']} />
        </p>
        <div className="grid grid-cols-11 gap-1">
          {RAMP.map((s) => (
            <div key={s} className="grid gap-1">
              <div className="h-8 rounded-[var(--radius-xs)]" style={{ background: `var(--brand-${s})` }} />
              <code className="text-center font-mono text-caption text-fg-3">{s}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('design.aurora')}>
        <div className="h-3 rounded-full bg-aurora" />
        <div className="flex items-center gap-4">
          <span className="aurora-ring grid size-16 place-items-center rounded-full p-[3px]">
            <span className="grid size-full place-items-center rounded-full border-2 border-bg bg-surface-2">
              <Avatar name="Demo Member" size={52} />
            </span>
          </span>
          <Card className="aurora-border flex-1 p-4">
            <b className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent-ink" aria-hidden /> {t('design.featured')}
            </b>
          </Card>
        </div>
        <div className="aurora-mesh grid h-28 place-items-center rounded-[var(--radius-lg)] border border-line">
          <span className="text-title font-bold">{t('design.hero')}</span>
        </div>
      </Section>

      <Section title={t('design.subjects')}>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
            <span
              key={n}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-callout font-semibold"
              style={{ background: `var(--subject-${n}-surface)`, color: `var(--subject-${n}-ink)` }}
            >
              <span className="size-2 rounded-full" style={{ background: `var(--subject-${n})` }} />
              {t('design.subject', { n })}
            </span>
          ))}
        </div>
      </Section>

      <Section title={t('design.status')}>
        <div className="grid grid-cols-2 gap-2">
          {STATUS.map((s) => (
            <div
              key={s}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border px-3 py-2"
              style={{
                background: `var(--${s}-surface)`,
                borderColor: `var(--${s}-border)`,
                color: `var(--${s}-ink)`,
              }}
            >
              <span className="flex items-center gap-2 font-semibold">
                <span className="size-2.5 rounded-full" style={{ background: `var(--${s}-fg)` }} />
                {s}
              </span>
              <Ratio fg={tok[`--${s}-ink`]} bg={tok[`--${s}-surface`]} />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {ROLES.map(([r, role]) => (
            <span
              key={r}
              className="rounded-full px-3 py-1 text-callout font-semibold"
              style={{ background: `var(--role-${r}-surface)`, color: `var(--role-${r}-ink)` }}
            >
              {t(`role.${role}`)}
            </span>
          ))}
        </div>
        <div className="flex h-20 items-end gap-2" aria-hidden>
          {[62, 88, 45, 70, 34, 55].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-[var(--radius-xs)]"
              style={{ height: `${h}%`, background: `var(--chart-${i + 1})` }}
            />
          ))}
        </div>
      </Section>

      <Section title={t('design.type')}>
        <div className="grid gap-2">
          {SCALE.map((s) => (
            <p
              key={s}
              className={cn('min-w-0', DISPLAY.has(s) && 'font-display font-bold')}
              style={{ fontSize: `var(--text-${s})`, lineHeight: `var(--lh-${s})` }}
            >
              <code className="mr-2 font-mono text-caption font-normal text-fg-3">{s}</code>
              {t(DISPLAY.has(s) ? 'design.short' : 'design.sample')}
            </p>
          ))}
          <p className="text-body" lang="te">
            {t('design.sampleTe')}
          </p>
          <p className="text-body" lang="hi">
            {t('design.sampleHi')}
          </p>
          <p className="font-mono text-callout tabular-nums text-fg-2">CSE ’21 · 1,284 XP · 10:30</p>
        </div>
      </Section>

      <Section title={t('design.shape')}>
        <div className="grid grid-cols-4 gap-2">
          {RADII.map((r) => (
            <Swatch key={r} name={r} className="bg-surface-2">
              <span
                className="h-8 w-14 border-2 border-brand"
                style={{ borderRadius: `var(--radius-${r})` }}
              />
            </Swatch>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {[0, 1, 2, 3, 4].map((e) => (
            <div
              key={e}
              className="grid h-16 place-items-center rounded-[var(--radius-md)] bg-surface-1 font-mono text-caption text-fg-3"
              style={{ boxShadow: `var(--elev-${e})` }}
            >
              elev-{e}
            </div>
          ))}
        </div>
        <div className="relative h-20 overflow-hidden rounded-[var(--radius-lg)] bg-aurora">
          <div className="glass absolute inset-x-3 bottom-3 rounded-full border border-line px-4 py-2 text-callout font-semibold">
            {t('design.glass')}
          </div>
        </div>
      </Section>

      <Section title={t('design.motion')}>
        <div className="grid gap-2">
          {SPRINGS.map((s) => (
            <div key={s} className="flex items-center gap-3">
              <code className="w-16 font-mono text-caption text-fg-3">{s}</code>
              <div className="relative h-8 flex-1 rounded-full bg-surface-2 [container-type:inline-size]">
                <span
                  className="absolute top-1 left-1 size-6 rounded-full bg-brand"
                  style={{
                    transform: played ? 'translateX(calc(100cqw - 2rem))' : 'none',
                    transition: `transform var(--dur-${s}) var(--ease-${s})`,
                  }}
                />
              </div>
            </div>
          ))}
          <Button size="sm" className="justify-self-start" onClick={() => setPlayed((p) => !p)}>
            {t('design.play')}
          </Button>
          <p className="text-caption text-fg-3">{t('design.v2.motionTokens')}</p>
        </div>
      </Section>

      <PrimitivesV2 />

      <Section title={t('design.components')}>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary">{t('common.save')}</Button>
          <Button variant="accent">{t('design.accent')}</Button>
          <Button>{t('common.cancel')}</Button>
          <Button variant="ghost">{t('design.ghost')}</Button>
          <Button variant="danger">{t('design.danger')}</Button>
          <Button variant="outline">{t('design.outline')}</Button>
          <Button variant="aurora">
            <Sparkles className="size-5" aria-hidden /> {t('design.ask')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm">
            {t('design.small')}
          </Button>
          <Button variant="primary" size="lg">
            <Heart className="size-5" aria-hidden /> {t('design.large')}
          </Button>
          <Button variant="primary" loading>
            {t('common.save')}
          </Button>
          <Button disabled>{t('design.disabled')}</Button>
          <Button size="icon" aria-label={t('design.icon')}>
            <Compass className="size-5" aria-hidden />
          </Button>
        </div>
        <Field label={t('design.field')} hint={t('design.hint')}>
          {({ id, describedBy }) => (
            <Input id={id} aria-describedby={describedBy} placeholder={t('design.placeholder')} />
          )}
        </Field>
        <Field label={t('design.field')} error={t('design.error')}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} defaultValue="CSE-21-117" />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Select aria-label={t('design.select')} defaultValue="b">
            <option value="a">CSE</option>
            <option value="b">ECE</option>
          </Select>
          <Checkbox id={checkId} checked={checked} onChange={setChecked}>
            {t('design.check')}
          </Checkbox>
        </div>
        <Textarea aria-label={t('design.textarea')} rows={2} defaultValue={t('design.sample')} />
        <OtpInput value={otp} onChange={setOtp} label={t('design.otp')} />
        <div className="flex flex-wrap gap-2">
          <Chip pressed={chip} onClick={() => setChip((c) => !c)}>
            {t('design.chip')}
          </Chip>
          <Chip pressed={!chip} onClick={() => setChip((c) => !c)}>
            {t('design.chip')}
          </Chip>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['neutral', 'brand', 'accent', 'success', 'warning', 'danger'] as const).map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
          <Badge mono>’21</Badge>
        </div>
        <Segmented
          label={t('design.segmented')}
          value={segment}
          onChange={setSegment}
          options={[
            ['a', t('design.optionA')],
            ['b', t('design.optionB')],
            ['c', t('design.optionC')],
          ]}
        />
        <Card className="flex items-center gap-3 p-4">
          <Avatar name="Demo Member" size={44} verified />
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </Card>
        <EmptyState icon={<Compass className="size-6" />} title={t('design.emptyTitle')}>
          {t('design.emptyBody')}
        </EmptyState>
        <Button className="justify-self-start" onClick={() => setDialog(true)}>
          {t('design.openDialog')}
        </Button>
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title={t('design.dialogTitle')}
          footer={
            <>
              <Button onClick={() => setDialog(false)}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={() => setDialog(false)}>
                {t('common.save')}
              </Button>
            </>
          }
        >
          <p className="text-fg-2">{t('design.sample')}</p>
        </Dialog>
        <Button className="justify-self-start" onClick={() => setSheet(true)}>
          {t('design.openSheet')}
        </Button>
        <Sheet open={sheet} onOpenChange={setSheet} title={t('design.sheetTitle')}>
          <p className="text-fg-2">{t('design.sheetBody')}</p>
        </Sheet>
        <PageHeader
          level={2}
          as="div"
          icon={<Compass />}
          title={t('design.title')}
          intro={t('design.sample')}
          actions={<Button size="sm">{t('design.small')}</Button>}
        />
        <Switch
          label={t('design.switchLabel')}
          description={t('design.switchHint')}
          checked={on}
          onChange={setOn}
        />
        <ChoiceGroup
          label={t('design.choice')}
          value={choice}
          onChange={setChoice}
          options={[
            {
              value: 'a',
              label: t('design.choiceA'),
              detail: (
                <span className="flex items-center gap-1">
                  <Clock className="size-3.5" aria-hidden /> {t('design.minutes', { n: 15 })}
                </span>
              ),
            },
            { value: 'b', label: t('design.choiceB'), detail: t('design.minutes', { n: 30 }) },
          ]}
        />
        <ChoiceGroup
          variant="chip"
          label={t('design.choice')}
          value={choice}
          onChange={setChoice}
          options={[
            { value: 'a', label: t('design.choiceA') },
            { value: 'b', label: t('design.choiceB') },
          ]}
        />
        <div>
          <Tabs
            label={t('design.tabs')}
            idBase={tabsId}
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'notes', label: t('design.tabNotes'), count: 12 },
              { id: 'slides', label: t('design.tabSlides'), count: 4 },
              { id: 'videos', label: t('design.tabVideos') },
            ]}
          />
          <TabPanel idBase={tabsId} id={tab} className="py-3 text-callout text-fg-2">
            {t('design.tabPanel', { tab: t(`design.tab${tab[0]?.toUpperCase()}${tab.slice(1)}`) })}
          </TabPanel>
        </div>
        <div className="grid gap-3">
          {(['brand', 'aurora', 'success', 'warning'] as const).map((tone, i) => (
            <ProgressBar
              key={tone}
              tone={tone}
              value={[64, 82, 100, 35][i] ?? 0}
              max={100}
              label={t('design.progress')}
              valueText={`${[64, 82, 100, 35][i] ?? 0}%`}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <ProgressRing value={0.68} label={t('design.ring')} valueText="68%" size={72} tone="aurora">
            <b className="text-callout tabular-nums">68%</b>
          </ProgressRing>
          <ProgressRing value={0.4} label={t('design.progress')} valueText="40%" size={56} />
          <Tooltip content={t('design.tooltip')}>
            <Button size="icon" aria-label={t('design.tooltip')}>
              <Info className="size-5" aria-hidden />
            </Button>
          </Tooltip>
          <AvatarStack
            label={t('design.stack')}
            people={[
              'Demo Member',
              'Demo Alum',
              'Demo Mentor',
              'Demo Student',
              'Demo Faculty',
              'Demo Guest',
            ].map((name) => ({ name }))}
          />
        </div>
        <StatGrid className="md:grid-cols-2">
          <StatCard
            icon={<Sparkles />}
            label={t('design.statSessions')}
            value="128"
            hint={t('design.statHint')}
            trend={[3, 5, 4, 8, 7, 11, 12]}
          />
          <StatCard
            label={t('design.statStreak')}
            value={t('design.days', { n: 9 })}
            hint={t('design.statHint')}
            tone="brand"
          />
        </StatGrid>
        <ColumnChart
          title={t('design.chart')}
          description={t('design.chartHint')}
          labelHeader={t('design.chartDay')}
          valueHeader={t('design.colCount')}
          points={[1200, 3400, 2100, 0, 5600, 4300, 6100].map((value, i) => ({
            key: String(i),
            label: t('design.chartDayN', { n: i + 1 }),
            value,
          }))}
        />
        <Table label={t('design.table')}>
          <THead>
            <tr>
              <Th>{t('design.colName')}</Th>
              <Th>{t('design.colBranch')}</Th>
              <Th className="text-right">{t('design.colCount')}</Th>
            </tr>
          </THead>
          <tbody>
            {DEMO_ROWS.map(([name, branch, n]) => (
              <tr key={name}>
                <Td>{name}</Td>
                <Td>{branch}</Td>
                <TdNum>{n}</TdNum>
              </tr>
            ))}
          </tbody>
        </Table>
        <ErrorState
          error={new Error('demo')}
          onRetry={() => undefined}
          title={t('design.errorDemo')}
          compact
        />
        {/* The specimen sits in place; in a real form it is fixed above the tab bar on phones. */}
        <FormFooter desktop="inline" className="!static rounded-[var(--radius-lg)] border">
          <Button variant="ghost">{t('common.cancel')}</Button>
          <Button variant="primary">{t('common.save')}</Button>
        </FormFooter>
        <Stepper
          label={t('design.stepper')}
          steps={[t('design.stepA'), t('design.stepB'), t('design.stepC')]}
          current={1}
        />
        <div className="flex flex-wrap items-center gap-2">
          {['STUDENT', 'ALUMNI', 'FACULTY', 'COLLEGE_ADMIN'].map((r) => (
            <RoleChip key={r} role={r} />
          ))}
          <span className="text-display text-brand-ink">
            <RadarSweep />
          </span>
        </div>
      </Section>

      <Section title={t('design.illustrations')}>
        <div className="grid grid-cols-4 gap-2">
          {ILLUSTRATIONS.map((k) => (
            <div key={k} className="grid justify-items-center gap-1 text-caption text-fg-3">
              <Illustration kind={k} size={72} />
              {k}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/** ADR 0015's primitives, in this specimen's theme and college colour. */
function PrimitivesV2() {
  const { t } = useTranslation();
  // Fixed once per visit (state initialisers run once): the countdowns tick from here.
  const [soon] = useState(() => new Date(Date.now() + 3 * 60_000).toISOString());
  const [later] = useState(() => new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString());
  const [chipOn, setChipOn] = useState(true);
  return (
    <>
      <Section title={t('design.v2.buttons')}>
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <div key={size} className="flex flex-wrap items-center gap-2">
            <Button size={size} variant="primary">
              {t('design.v2.register')}
            </Button>
            <Button size={size} variant="secondary">
              {t('design.v2.notNow')}
            </Button>
            <Button size={size} variant="tertiary">
              {t('ui.seeAll')}
            </Button>
            <Button size={size} variant="danger">
              {t('design.v2.withdraw')}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading>
            {t('design.v2.register')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.undo(t('design.v2.toastDone'), t('ui.undo'), () => undefined)}
          >
            {t('design.v2.markDone')}
          </Button>
        </div>
      </Section>

      <Section title={t('design.v2.primitives')}>
        <PageHeader
          level={2}
          title={t('design.v2.headerTitle')}
          subtitle={t('design.v2.headerSubtitle')}
          about={<p>{t('design.v2.headerAbout')}</p>}
          overflow={[{ label: t('design.v2.history'), onSelect: () => undefined }]}
          primary={<Button variant="primary">{t('design.v2.register')}</Button>}
        />
        <Toolbar
          search={<Input aria-label={t('design.v2.searchPaths')} placeholder={t('design.v2.searchPaths')} />}
          filters={
            <>
              <Chip pressed={chipOn} onClick={() => setChipOn((c) => !c)}>
                CSE
              </Chip>
              <Chip pressed={false}>ECE</Chip>
            </>
          }
          activeFilters={chipOn ? 1 : 0}
          onClearFilters={() => setChipOn(false)}
        />
        <ActionCard
          kicker={t('design.v2.actionKicker')}
          title={t('design.v2.rowTitle')}
          meta={t('design.v2.actionMeta')}
          deadline={<Countdown at={soon} kind="starts" />}
          leading={<Avatar name={t('design.v2.personName')} size={48} />}
          action={<Button variant="primary">{t('design.v2.join')}</Button>}
        />
        <ListSection
          title={t('design.v2.sectionTitle')}
          action={
            <Button variant="tertiary" size="sm">
              {t('ui.seeAll')}
            </Button>
          }
        >
          <ListRow
            leading={<Avatar name={t('design.v2.personName')} size={40} />}
            title={t('design.v2.rowTitle')}
            meta={t('design.v2.rowMeta')}
            onClick={() => undefined}
            chevron
          />
          <ListRow
            title={t('design.v2.row2Title')}
            meta={
              <span className="flex flex-wrap items-center gap-2">
                {t('design.v2.row2Meta')} <Countdown at={later} />
              </span>
            }
            trailing={
              <Button size="sm" variant="primary">
                {t('design.v2.register')}
              </Button>
            }
          />
        </ListSection>
        <div className="grid gap-3 sm:grid-cols-2">
          <PersonCard
            name={t('design.v2.personName')}
            role={t('design.v2.personRole')}
            batch={t('design.v2.personBatch')}
            reason={t('design.v2.personReason')}
            demo
            demoLabel={t('common.demo')}
            action={<Button size="sm">{t('design.v2.follow')}</Button>}
          />
          <PersonCard
            layout="row"
            name={t('design.v2.personName')}
            role={t('design.v2.personRole')}
            batch={t('design.v2.personBatch')}
            action={<Button size="sm">{t('design.v2.follow')}</Button>}
          />
        </div>
        <StepTrack
          label={t('design.v2.track')}
          onOpen={() => undefined}
          phases={[
            {
              name: t('design.v2.phase1'),
              steps: [
                { id: 'a', title: t('design.v2.step1'), state: 'done', meta: t('design.v2.weeks1') },
                {
                  id: 'b',
                  title: t('design.v2.step2'),
                  state: 'next',
                  meta: t('design.v2.weeks2'),
                  badge: <Badge tone="accent">{t('ui.proof')}</Badge>,
                },
              ],
            },
            {
              name: t('design.v2.phase2'),
              steps: [
                { id: 'c', title: t('design.v2.step3'), state: 'upcoming', meta: t('design.v2.weeks1') },
              ],
            },
          ]}
        />
        <ScoreRing
          score={48}
          label={t('design.v2.score')}
          caption={t('design.v2.of100')}
          delta={t('design.v2.delta')}
        />
        <Timeline
          label={t('design.v2.rounds')}
          items={[
            {
              id: '1',
              time: formatDay(new Date()),
              title: t('design.v2.round1'),
              state: 'past',
              badge: <Badge tone="success">{t('design.v2.selected')}</Badge>,
            },
            { id: '2', time: formatDay(soon), title: t('design.v2.round2'), state: 'current' },
            { id: '3', time: formatDay(later), title: t('design.v2.round3'), state: 'future' },
          ]}
        />
        <EmptyState
          title={t('design.v2.emptyTitle')}
          preview={
            <div className="rounded-[var(--radius-md)] border border-line bg-surface-1">
              <SkeletonRow />
              <SkeletonRow />
            </div>
          }
          action={<Button variant="primary">{t('design.v2.findSenior')}</Button>}
        >
          {t('design.v2.emptyBody')}
        </EmptyState>
        <p className="text-callout text-fg-2">{t('design.v2.shortcut', { a: 'Ctrl', b: 'K' })}</p>
        <div className="flex gap-1">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </div>
      </Section>

      <Section title={t('design.v2.skeletons')}>
        <div className="rounded-[var(--radius-md)] border border-line bg-surface-1">
          <SkeletonRow trailing />
        </div>
        <SkeletonCard />
        <SkeletonChart height={120} />
      </Section>

      <Section title={t('design.v2.languages')}>
        <ListSection>
          <ListRow title={t('design.v2.rowTitle')} meta={t('design.v2.rowMeta')} chevron />
          <ListRow
            title={<span lang="te">{t('design.sampleTe')}</span>}
            meta={<span lang="te">{t('design.sampleTe')}</span>}
            chevron
          />
          <ListRow
            title={<span lang="hi">{t('design.sampleHi')}</span>}
            meta={<span lang="hi">{t('design.sampleHi')}</span>}
            chevron
          />
        </ListSection>
      </Section>

      <Section title={t('design.v2.density')}>
        <div data-density="compact">
          <ListSection>
            <ListRow title={t('design.v2.row2Title')} meta={t('design.v2.row2Meta')} chevron />
            <ListRow title={t('design.v2.rowTitle')} meta={t('design.v2.rowMeta')} chevron />
          </ListSection>
        </div>
      </Section>
    </>
  );
}

export function StyleGuidePage() {
  const { t } = useTranslation();
  const [collegeId, setCollegeId] = useState<CollegeId>('dpit');
  const college = COLLEGES.find((c) => c.id === collegeId) ?? COLLEGES[0];
  const { css } = useMemo(() => specimenCss(college), [college]);
  return (
    <main id="main" className="gutter mx-auto grid max-w-[1400px] gap-6 py-8">
      <style>{css}</style>
      <header className="grid gap-3">
        <h1 className="text-display font-bold">{t('design.title')}</h1>
        <p className="max-w-[70ch] text-fg-2">{t('design.intro')}</p>
        <label className="flex flex-wrap items-center gap-3 text-callout font-semibold">
          {t('design.college')}
          <Select
            value={collegeId}
            onChange={(e) => setCollegeId(e.target.value as CollegeId)}
            className="inline-block w-auto"
          >
            {COLLEGES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </label>
      </header>
      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen college={college} theme="light" />
        <Specimen college={college} theme="dark" />
      </div>
    </main>
  );
}
