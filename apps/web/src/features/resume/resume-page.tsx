import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Download, Eye, Plus, Sparkles, Trash2, UserRoundSearch } from 'lucide-react';
import {
  RESUME_TEMPLATES,
  resumeContent,
  type ResumeContent,
  type ResumeTemplate,
  type ResumeView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Sheet } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { Card, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { Stepper } from '../../components/ui/stepper';
import { Segmented } from '../../components/ui/tab-nav';
import { TagInput } from '../../components/ui/tag-input';
import { api, apiBlob, ApiError, saveBlob } from '../../lib/api';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import { useMedia } from '../../lib/use-media';
import { AtsPanel } from './ats-panel';
import { ResumeComments } from './resume-comments';
import { ResumePreview } from './resume-preview';
import { InlineRewrite, type RewriteTarget } from './rewrite-sheet';

/** The editor's parts: one at a time on a phone (a stepper), all at once beside the preview on a wide screen. */
const STEPS = ['basics', 'education', 'work', 'projects', 'skills', 'more', 'check'] as const;
type Step = (typeof STEPS)[number];
type Side = 'preview' | 'check' | 'comments';
const WIDE = '(min-width: 1024px)';

function useDownload(r: ResumeView) {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: () => apiBlob(`/resumes/${r.id}/pdf`),
    onSuccess: (blob) => saveBlob(blob, `${r.title.replace(/[^\w-]+/g, '-') || 'resume'}.pdf`),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
}

/** One text box, labelled; dates take `YYYY` or `YYYY-MM`. */
function Text({
  label,
  value,
  onChange,
  max,
  hint,
  multiline,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  hint?: string;
  multiline?: boolean;
  placeholder?: string;
  inputMode?: 'email' | 'tel' | 'url' | 'numeric';
}) {
  return (
    <Field label={label} hint={hint}>
      {({ id, describedBy }) =>
        multiline ? (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            rows={3}
            maxLength={max}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <Input
            id={id}
            aria-describedby={describedBy}
            maxLength={max}
            value={value}
            placeholder={placeholder}
            inputMode={inputMode}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      }
    </Field>
  );
}

/** A section of entries (education, experience…): each in its own card, added and removed in place. */
function Entries<T>({
  title,
  items,
  max,
  blank,
  onChange,
  render,
}: {
  title: string;
  items: T[];
  max: number;
  blank: T;
  onChange: (items: T[]) => void;
  render: (item: T, set: (patch: Partial<T>) => void, i: number) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="grid gap-3" aria-label={title}>
      <h2 className="text-headline font-semibold">{title}</h2>
      {items.map((item, i) => (
        <Card key={i} variant="flat" className="grid gap-3 p-4">
          {render(item, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))), i)}
          <div>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('resume.removeEntry', { section: title, n: i + 1 })}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" aria-hidden /> {t('resume.remove')}
            </Button>
          </div>
        </Card>
      ))}
      {items.length < max && (
        <div>
          <Button size="sm" onClick={() => onChange([...items, structuredClone(blank)])}>
            <Plus className="size-4" aria-hidden /> {t('resume.addTo', { section: title })}
          </Button>
        </div>
      )}
    </section>
  );
}

/** Up to six bullets; saved bullets on experience and projects can be tightened (AI or rules). */
function BulletsEditor({
  label,
  items,
  onChange,
  improve,
  suggestion,
}: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
  improve: ((bullet: number) => void) | null;
  /** An inline rewrite under one bullet (prompt 3, U7). */
  suggestion?: { bullet: number; node: ReactNode } | undefined;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-callout font-semibold">{label}</legend>
      {items.map((b, i) => (
        <div key={i} className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-start">
            <Textarea
              aria-label={t('resume.bulletN', { n: i + 1 })}
              rows={2}
              maxLength={220}
              value={b}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
            {improve && (
              <Button size="sm" disabled={!b.trim()} onClick={() => improve(i)}>
                <Sparkles className="size-4" aria-hidden /> {t('resume.improve')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('resume.removeBullet', { n: i + 1 })}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
          {suggestion?.bullet === i && suggestion.node}
        </div>
      ))}
      {items.length < 6 && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => onChange([...items, ''])}>
            <Plus className="size-4" aria-hidden /> {t('resume.addBullet')}
          </Button>
        </div>
      )}
    </fieldset>
  );
}

/** The first problem Zod finds, with where it is, in words the member can act on. */
function firstProblem(
  t: (k: string, o?: Record<string, unknown>) => string,
  c: ResumeContent,
): string | null {
  const parsed = resumeContent.safeParse(c);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  if (!issue) return null;
  const [section, index] = issue.path;
  const where =
    typeof section === 'string'
      ? `${t(`resume.section.${section}`)}${typeof index === 'number' ? ` ${index + 1}` : ''}`
      : '';
  return where ? `${where}: ${issue.message}` : issue.message;
}

function Editor({ resume: r }: { resume: ResumeView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [title, setTitle] = useState(r.title);
  const [template, setTemplate] = useState<ResumeTemplate>(r.template);
  const [content, setContent] = useState<ResumeContent>(r.content);
  const [dirty, setDirty] = useState(false);
  const [problem, setProblem] = useState('');
  const wide = useMedia(WIDE);
  // In the address, so saving (which remounts the editor at the new version) keeps the place.
  const [params, setParams] = useSearchParams();
  const step = Math.max(0, STEPS.indexOf(params.get('part') as Step));
  const asked = params.get('view') as Side | null;
  const side: Side = asked === 'check' || asked === 'comments' ? asked : 'preview';
  const setPlace = (patch: { part?: Step; view?: Side }) =>
    setParams(
      (p) => {
        if (patch.part) p.set('part', patch.part);
        if (patch.view) p.set('view', patch.view);
        return p;
      },
      { replace: true },
    );
  const setStep = (next: (x: number) => number) => setPlace({ part: STEPS[next(step)] ?? 'basics' });
  const setSide = (view: Side) => setPlace({ view });
  const [previewOpen, setPreviewOpen] = useState(false);
  const show = (id: Step) => wide || STEPS[step] === id;
  const [rewriting, setRewriting] = useState<(RewriteTarget & { apply: (s: string) => void }) | null>(null);
  const download = useDownload(r);
  const edit = (c: ResumeContent) => {
    setContent(c);
    setDirty(true);
  };
  const save = useMutation({
    mutationFn: () =>
      api.put<ResumeView>(`/resumes/${r.id}`, { version: r.version, title: title.trim(), template, content }),
    onSuccess: (next) => {
      qc.setQueryData(q.resume(r.id).queryKey, next);
      void qc.invalidateQueries({ queryKey: ['resumes'] });
      setContent(next.content);
      setDirty(false);
      setProblem('');
      toast.success(t('resume.savedToast'));
    },
    onError: (e) => setProblem(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const onSave = () => {
    const p = firstProblem(t, content) ?? (title.trim() ? null : t('resume.nameNeeded'));
    if (p) return setProblem(p);
    save.mutate();
  };
  const b = content.basics;
  const setBasics = (patch: Partial<ResumeContent['basics']>) =>
    edit({ ...content, basics: { ...b, ...patch } });
  const improve = (section: 'work' | 'projects', entry: number) =>
    dirty
      ? null
      : (bullet: number) =>
          setRewriting({
            section,
            entry,
            bullet,
            apply: (s) => {
              const list = content[section].map((x, j) =>
                j === entry ? { ...x, highlights: x.highlights.map((h, k) => (k === bullet ? s : h)) } : x,
              );
              edit({ ...content, [section]: list });
            },
          });

  const suggestionFor = (section: 'work' | 'projects', entry: number) =>
    rewriting && rewriting.section === section && rewriting.entry === entry
      ? {
          bullet: rewriting.bullet,
          node: (
            <InlineRewrite
              key={`${section}-${entry}-${rewriting.bullet}`}
              resumeId={r.id}
              target={{ section, entry, bullet: rewriting.bullet }}
              onClose={() => setRewriting(null)}
              onPick={(text) => {
                rewriting.apply(text);
                setRewriting(null);
              }}
            />
          ),
        }
      : undefined;
  const checkPanel = <AtsPanel resume={r} content={content} dirty={dirty} />;

  return (
    <div className="grid gap-5">
      <PageHeader
        title={r.title}
        // On a phone the two go behind "More actions", so Save and the first part lead (U7).
        overflow={
          wide
            ? []
            : [
                { label: t('resume.download'), onSelect: () => download.mutate() },
                { label: t('resume.askReview'), to: '/mentors?view=browse&type=resume_review' },
              ]
        }
        actions={
          wide ? (
            <>
              <Button loading={download.isPending} disabled={dirty} onClick={() => download.mutate()}>
                <Download className="size-4" aria-hidden /> {t('resume.download')}
              </Button>
              <Link
                to="/mentors?view=browse&type=resume_review"
                className={buttonVariants({ variant: 'outline' })}
              >
                <UserRoundSearch className="size-4" aria-hidden /> {t('resume.askReview')}
              </Link>
            </>
          ) : null
        }
      />
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur">
        <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={onSave}>
          {t('common.save')}
        </Button>
        <span className="text-callout text-fg-2" aria-live="polite">
          {dirty ? t('resume.unsaved') : t('resume.allSaved')}
        </span>
        {!wide && (
          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setPreviewOpen(true)}>
            <Eye className="size-4" aria-hidden /> {t('resume.tab.preview')}
          </Button>
        )}
      </div>
      {problem && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] bg-danger-surface p-3 text-callout text-danger-ink"
        >
          {problem}
        </p>
      )}
      {!wide && (
        <Stepper
          steps={STEPS.map((x) => t(`resume.step.${x}`))}
          current={step}
          label={t('resume.stepsLabel')}
        />
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
        <div className="grid min-w-0 gap-8">
          {show('basics') && (
            <>
              <p className="text-callout text-fg-2">{t('resume.english')}</p>
              <section
                className="grid gap-3 sm:grid-cols-2 sm:items-start"
                aria-label={t('resume.section.basics')}
              >
                <Text
                  label={t('resume.name')}
                  value={title}
                  max={60}
                  onChange={(v) => {
                    setTitle(v);
                    setDirty(true);
                  }}
                />
                <Field label={t('resume.template')}>
                  {({ id }) => (
                    <Select
                      id={id}
                      value={template}
                      onChange={(e) => {
                        setTemplate(e.target.value as ResumeTemplate);
                        setDirty(true);
                      }}
                    >
                      {RESUME_TEMPLATES.map((v) => (
                        <option key={v} value={v}>
                          {t(`resume.templates.${v}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Text
                  label={t('resume.f.fullName')}
                  value={b.name}
                  max={80}
                  onChange={(v) => setBasics({ name: v })}
                />
                <Text
                  label={t('resume.f.headline')}
                  value={b.label}
                  max={80}
                  hint={t('resume.f.headlineHint')}
                  onChange={(v) => setBasics({ label: v })}
                />
                <Text
                  label={t('resume.f.email')}
                  value={b.email}
                  max={120}
                  inputMode="email"
                  onChange={(v) => setBasics({ email: v })}
                />
                <Text
                  label={t('resume.f.phone')}
                  value={b.phone}
                  max={30}
                  inputMode="tel"
                  onChange={(v) => setBasics({ phone: v })}
                />
                <Text
                  label={t('resume.f.location')}
                  value={b.location}
                  max={80}
                  onChange={(v) => setBasics({ location: v })}
                />
                <div className="sm:col-span-2">
                  <Text
                    label={t('resume.f.summary')}
                    value={b.summary}
                    max={600}
                    multiline
                    hint={t('resume.f.summaryHint')}
                    onChange={(v) => setBasics({ summary: v })}
                  />
                </div>
              </section>
              <Entries
                title={t('resume.section.profiles')}
                items={b.profiles}
                max={4}
                blank={{ network: '', url: '' }}
                onChange={(profiles) => setBasics({ profiles })}
                render={(p, set) => (
                  <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                    <Text
                      label={t('resume.f.network')}
                      value={p.network}
                      max={30}
                      placeholder="LinkedIn"
                      onChange={(v) => set({ network: v })}
                    />
                    <Text
                      label={t('resume.f.url')}
                      value={p.url}
                      max={200}
                      inputMode="url"
                      placeholder="https://"
                      onChange={(v) => set({ url: v })}
                    />
                  </div>
                )}
              />
            </>
          )}
          {show('education') && (
            <Entries
              title={t('resume.section.education')}
              items={content.education}
              max={5}
              blank={{ institution: '', area: '', studyType: '', startDate: '', endDate: '', score: '' }}
              onChange={(education) => edit({ ...content, education })}
              render={(e, set) => (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Text
                    label={t('resume.f.institution')}
                    value={e.institution}
                    max={120}
                    onChange={(v) => set({ institution: v })}
                  />
                  <Text
                    label={t('resume.f.studyType')}
                    value={e.studyType}
                    max={60}
                    placeholder="B.Tech"
                    onChange={(v) => set({ studyType: v })}
                  />
                  <Text
                    label={t('resume.f.area')}
                    value={e.area}
                    max={80}
                    onChange={(v) => set({ area: v })}
                  />
                  <Text
                    label={t('resume.f.score')}
                    value={e.score}
                    max={30}
                    placeholder="8.4 CGPA"
                    onChange={(v) => set({ score: v })}
                  />
                  <Text
                    label={t('resume.f.start')}
                    value={e.startDate}
                    max={7}
                    placeholder="2022-08"
                    onChange={(v) => set({ startDate: v })}
                  />
                  <Text
                    label={t('resume.f.end')}
                    value={e.endDate}
                    max={7}
                    placeholder="2026-05"
                    hint={t('resume.f.endHint')}
                    onChange={(v) => set({ endDate: v })}
                  />
                </div>
              )}
            />
          )}
          {show('work') && (
            <Entries
              title={t('resume.section.work')}
              items={content.work}
              max={8}
              blank={{ name: '', position: '', startDate: '', endDate: '', highlights: [''] }}
              onChange={(work) => edit({ ...content, work })}
              render={(w, set, i) => (
                <div className="grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Text
                      label={t('resume.f.position')}
                      value={w.position}
                      max={80}
                      onChange={(v) => set({ position: v })}
                    />
                    <Text
                      label={t('resume.f.organisation')}
                      value={w.name}
                      max={100}
                      onChange={(v) => set({ name: v })}
                    />
                    <Text
                      label={t('resume.f.start')}
                      value={w.startDate}
                      max={7}
                      placeholder="2025-05"
                      onChange={(v) => set({ startDate: v })}
                    />
                    <Text
                      label={t('resume.f.end')}
                      value={w.endDate}
                      max={7}
                      placeholder="2025-07"
                      hint={t('resume.f.endHint')}
                      onChange={(v) => set({ endDate: v })}
                    />
                  </div>
                  <BulletsEditor
                    label={t('resume.f.highlights')}
                    items={w.highlights}
                    onChange={(highlights) => set({ highlights })}
                    improve={improve('work', i)}
                    suggestion={suggestionFor('work', i)}
                  />
                </div>
              )}
            />
          )}
          {show('projects') && (
            <Entries
              title={t('resume.section.projects')}
              items={content.projects}
              max={8}
              blank={{ name: '', description: '', url: '', highlights: [''] }}
              onChange={(projects) => edit({ ...content, projects })}
              render={(p, set, i) => (
                <div className="grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Text
                      label={t('resume.f.projectName')}
                      value={p.name}
                      max={100}
                      onChange={(v) => set({ name: v })}
                    />
                    <Text
                      label={t('resume.f.url')}
                      value={p.url}
                      max={200}
                      inputMode="url"
                      placeholder="https://"
                      onChange={(v) => set({ url: v })}
                    />
                  </div>
                  <Text
                    label={t('resume.f.description')}
                    value={p.description}
                    max={300}
                    multiline
                    onChange={(v) => set({ description: v })}
                  />
                  <BulletsEditor
                    label={t('resume.f.highlights')}
                    items={p.highlights}
                    onChange={(highlights) => set({ highlights })}
                    improve={improve('projects', i)}
                    suggestion={suggestionFor('projects', i)}
                  />
                </div>
              )}
            />
          )}
          {show('skills') && (
            <Entries
              title={t('resume.section.skills')}
              items={content.skills}
              max={10}
              blank={{ name: '', keywords: [] }}
              onChange={(skills) => edit({ ...content, skills })}
              render={(s, set) => (
                <div className="grid gap-3">
                  <Text
                    label={t('resume.f.skillGroup')}
                    value={s.name}
                    max={60}
                    placeholder="Languages"
                    onChange={(v) => set({ name: v })}
                  />
                  <TagInput
                    label={t('resume.f.keywords')}
                    value={s.keywords}
                    max={15}
                    onChange={(keywords) => set({ keywords })}
                  />
                </div>
              )}
            />
          )}
          {show('more') && (
            <>
              <Entries
                title={t('resume.section.certificates')}
                items={content.certificates}
                max={10}
                blank={{ name: '', issuer: '', date: '' }}
                onChange={(certificates) => edit({ ...content, certificates })}
                render={(x, set) => (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Text
                      label={t('resume.f.certificate')}
                      value={x.name}
                      max={120}
                      onChange={(v) => set({ name: v })}
                    />
                    <Text
                      label={t('resume.f.issuer')}
                      value={x.issuer}
                      max={80}
                      onChange={(v) => set({ issuer: v })}
                    />
                    <Text
                      label={t('resume.f.date')}
                      value={x.date}
                      max={7}
                      placeholder="2025-03"
                      onChange={(v) => set({ date: v })}
                    />
                  </div>
                )}
              />
              <Entries
                title={t('resume.section.awards')}
                items={content.awards}
                max={10}
                blank={{ title: '', awarder: '', date: '' }}
                onChange={(awards) => edit({ ...content, awards })}
                render={(x, set) => (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Text
                      label={t('resume.f.award')}
                      value={x.title}
                      max={120}
                      onChange={(v) => set({ title: v })}
                    />
                    <Text
                      label={t('resume.f.awarder')}
                      value={x.awarder}
                      max={80}
                      onChange={(v) => set({ awarder: v })}
                    />
                    <Text
                      label={t('resume.f.date')}
                      value={x.date}
                      max={7}
                      placeholder="2025"
                      onChange={(v) => set({ date: v })}
                    />
                  </div>
                )}
              />
            </>
          )}
          {dirty && (show('work') || show('projects')) && (
            <p className="text-callout text-fg-2">{t('resume.improveAfterSave')}</p>
          )}
          {!wide && STEPS[step] === 'check' && (
            <>
              {checkPanel}
              <ResumeComments resume={r} />
            </>
          )}
          {!wide && (
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                variant="ghost"
                disabled={step === 0}
                onClick={() => {
                  setStep((x) => Math.max(0, x - 1));
                  window.scrollTo({ top: 0 });
                }}
              >
                <ArrowLeft className="size-4" aria-hidden /> {t('common.back')}
              </Button>
              {step < STEPS.length - 1 && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStep((x) => Math.min(STEPS.length - 1, x + 1));
                    window.scrollTo({ top: 0 });
                  }}
                >
                  {t(`resume.step.${STEPS[step + 1] ?? 'check'}`)}{' '}
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              )}
            </div>
          )}
        </div>
        {wide && (
          <aside className="sticky top-4 grid max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto">
            <Segmented
              label={t('resume.views')}
              value={side}
              onChange={setSide}
              options={[
                ['preview', t('resume.tab.preview')],
                ['check', t('resume.tab.check')],
                ['comments', t('resume.tab.comments')],
              ]}
            />
            {side === 'preview' ? (
              <ResumePreview content={content} template={template} />
            ) : side === 'check' ? (
              checkPanel
            ) : (
              <ResumeComments resume={r} />
            )}
          </aside>
        )}
      </div>
      {!wide && (
        <Sheet open={previewOpen} onOpenChange={setPreviewOpen} title={t('resume.tab.preview')}>
          <ResumePreview content={content} template={template} />
        </Sheet>
      )}
    </div>
  );
}

/** A résumé someone asked the viewer to review: read, download and comment, never edit. */
function Review({ resume: r }: { resume: ResumeView }) {
  const { t } = useTranslation();
  const download = useDownload(r);
  return (
    <div className="grid gap-5">
      <PageHeader
        title={t('resume.reviewTitle', { name: r.owner.name })}
        intro={t('resume.reviewIntro')}
        actions={
          <Button loading={download.isPending} onClick={() => download.mutate()}>
            <Download className="size-4" aria-hidden /> {t('resume.download')}
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <ResumePreview content={r.content} template={r.template} />
        <ResumeComments resume={r} />
      </div>
    </div>
  );
}

/** One résumé (prompt 2, G2): the owner edits it; a reviewer they asked reads and comments. */
export function ResumePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const r = useQuery({ ...SCREEN, ...q.resume(id) });
  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-4">
      <BackLink to={r.data && !r.data.mine ? '/mentorship' : '/resume'}>
        {r.data && !r.data.mine ? t('nav.requests') : t('nav.resume')}
      </BackLink>
      {r.isLoading && <Skeleton className="h-80 rounded-[var(--radius-lg)]" />}
      {r.isError && <ErrorState error={r.error} onRetry={() => void r.refetch()} />}
      {r.data &&
        (r.data.mine ? (
          <Editor key={`${r.data.id}-${r.data.version}`} resume={r.data} />
        ) : (
          <Review resume={r.data} />
        ))}
    </div>
  );
}
