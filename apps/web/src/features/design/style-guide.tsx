import { useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Compass, Heart, Sparkles } from 'lucide-react';
import { contrastRatio, generatePalette, parseOklch, staticTokens, type Theme } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { Avatar, Badge, Card, Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { OtpInput } from '../../components/ui/otp';
import { Segmented } from '../../components/ui/tab-nav';
import { cn } from '../../lib/cn';

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
const SCALE = ['hero', 'display', 'headline', 'title', 'lead', 'body', 'meta', 'caption'] as const;
const RADII = ['xs', 'sm', 'md', 'lg', 'xl', 'pill'] as const;
/** The display steps use the display face and a short phrase. */
const DISPLAY = new Set<string>(['hero', 'display', 'headline']);
const SPRINGS = ['snappy', 'smooth', 'bouncy'] as const;

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
  return (
    <div
      data-palette={college.id}
      data-theme={theme}
      className="grid min-w-0 content-start gap-8 rounded-[var(--radius-xl)] border border-line bg-bg p-5 text-fg"
    >
      <h2 className="text-title font-bold">{t(theme === 'light' ? 'design.light' : 'design.dark')}</h2>

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
              <code className="text-center font-mono text-[10px] text-fg-3">{s}</code>
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
          <span className="text-headline font-bold">{t('design.hero')}</span>
        </div>
      </Section>

      <Section title={t('design.subjects')}>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
            <span
              key={n}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-meta font-semibold"
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
              className="rounded-full px-3 py-1 text-meta font-semibold"
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
              className={cn('min-w-0', DISPLAY.has(s) && 'font-display leading-tight font-bold')}
              style={{ fontSize: `var(--text-${s})` }}
            >
              <code className="mr-2 font-mono text-caption font-normal text-fg-3">{s}</code>
              {t(DISPLAY.has(s) ? 'design.short' : 'design.sample')}
            </p>
          ))}
          <p className="text-lead" lang="te">
            {t('design.sampleTe')}
          </p>
          <p className="font-mono text-meta tabular-nums text-fg-2">CSE ’21 · 1,284 XP · 10:30</p>
        </div>
      </Section>

      <Section title={t('design.shape')}>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
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
          <div className="glass absolute inset-x-3 bottom-3 rounded-full border border-line px-4 py-2 text-meta font-semibold">
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
        </div>
      </Section>

      <Section title={t('design.components')}>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary">{t('common.save')}</Button>
          <Button variant="accent">{t('design.accent')}</Button>
          <Button>{t('common.cancel')}</Button>
          <Button variant="ghost">{t('design.ghost')}</Button>
          <Button variant="danger">{t('design.danger')}</Button>
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
        <Dialog open={dialog} onOpenChange={setDialog} title={t('design.dialogTitle')}>
          <p className="text-fg-2">{t('design.sample')}</p>
        </Dialog>
      </Section>
    </div>
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
        <label className="flex flex-wrap items-center gap-3 text-meta font-semibold">
          {t('design.college')}
          <Select
            value={collegeId}
            onChange={(e) => setCollegeId(e.target.value as CollegeId)}
            className="w-auto"
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
