import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Plus, Send, Trash2, X } from 'lucide-react';
import {
  BRANCHES,
  NODE_KINDS,
  ROADMAP_CATEGORIES,
  publishProblems,
  roadmapContent,
  type RoadmapContent,
  type RoadmapNode,
  type RoadmapView,
  type SourceRef,
  type VersionView,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { Card, Skeleton } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/format';

const blankNode = (i: number): RoadmapNode => ({
  id: `step-${i}`,
  title: '',
  kind: 'skill',
  summary: '',
  prerequisites: [],
  estimateHours: [5, 10],
  resources: [],
  proof: '',
  sources: [],
  needsReview: true,
});
const blank = (): RoadmapContent => ({
  title: '',
  summary: '',
  category: 'software',
  branches: ['CSE'],
  outcomes: [],
  sources: [],
  nodes: [blankNode(1)],
});

function RefList({
  label,
  items,
  onChange,
  max,
  idPrefix,
}: {
  label: string;
  items: SourceRef[];
  onChange: (v: SourceRef[]) => void;
  max: number;
  idPrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-semibold">{label}</legend>
      {items.map((s, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
          <Input
            aria-label={t('roadmaps.editor.refTitle', { n: i + 1 })}
            id={`${idPrefix}-title-${i}`}
            value={s.title}
            placeholder={t('roadmaps.editor.refTitlePh')}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
          />
          <Input
            aria-label={t('roadmaps.editor.refUrl', { n: i + 1 })}
            type="url"
            inputMode="url"
            value={s.url}
            placeholder="https://"
            onChange={(e) =>
              onChange(items.map((x, j) => (j === i ? { ...x, url: e.target.value.trim() } : x)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('roadmaps.editor.removeRef', { n: i + 1 })}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      ))}
      {items.length < max && (
        <Button
          type="button"
          size="sm"
          className="justify-self-start"
          onClick={() => onChange([...items, { title: '', url: '' }])}
        >
          <Plus className="size-4" aria-hidden /> {t('roadmaps.editor.addRef')}
        </Button>
      )}
    </fieldset>
  );
}

function NodeEditor({
  node,
  index,
  all,
  onChange,
  onMove,
  onRemove,
}: {
  node: RoadmapNode;
  index: number;
  all: RoadmapNode[];
  onChange: (n: RoadmapNode) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const p = `node-${index}`;
  const set = <K extends keyof RoadmapNode>(k: K, v: RoadmapNode[K]) => onChange({ ...node, [k]: v });
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">
          {t('roadmaps.editor.step', { n: index + 1 })}
          {node.title && `: ${node.title}`}
        </h3>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('roadmaps.editor.moveUp')}
            onClick={() => onMove(-1)}
            disabled={index === 0}
          >
            <ArrowUp className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('roadmaps.editor.moveDown')}
            onClick={() => onMove(1)}
            disabled={index === all.length - 1}
          >
            <ArrowDown className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('roadmaps.editor.removeStep')}
            onClick={onRemove}
            disabled={all.length === 1}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px_150px]">
        <Field label={t('roadmaps.editor.stepTitle')}>
          {(f) => (
            <Input
              id={f.id}
              aria-describedby={f.describedBy}
              value={node.title}
              maxLength={100}
              onChange={(e) => set('title', e.target.value)}
            />
          )}
        </Field>
        <Field label={t('roadmaps.editor.stepId')} hint={t('roadmaps.editor.stepIdHint')}>
          {(f) => (
            <Input
              id={f.id}
              aria-describedby={f.describedBy}
              value={node.id}
              maxLength={40}
              onChange={(e) => set('id', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            />
          )}
        </Field>
        <Field label={t('roadmaps.editor.kind')}>
          {(f) => (
            <Select
              id={f.id}
              aria-describedby={f.describedBy}
              value={node.kind}
              onChange={(e) => set('kind', e.target.value as RoadmapNode['kind'])}
            >
              {NODE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`roadmaps.kind.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label={t('roadmaps.editor.stepSummary')}>
        {(f) => (
          <Textarea
            id={f.id}
            aria-describedby={f.describedBy}
            value={node.summary}
            maxLength={400}
            rows={2}
            onChange={(e) => set('summary', e.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('roadmaps.editor.hoursMin')}>
          {(f) => (
            <Input
              id={f.id}
              aria-describedby={f.describedBy}
              type="number"
              min={0}
              max={2000}
              value={node.estimateHours[0]}
              onChange={(e) => set('estimateHours', [Number(e.target.value), node.estimateHours[1]])}
            />
          )}
        </Field>
        <Field label={t('roadmaps.editor.hoursMax')}>
          {(f) => (
            <Input
              id={f.id}
              aria-describedby={f.describedBy}
              type="number"
              min={0}
              max={2000}
              value={node.estimateHours[1]}
              onChange={(e) => set('estimateHours', [node.estimateHours[0], Number(e.target.value)])}
            />
          )}
        </Field>
      </div>
      {index > 0 && (
        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-semibold">{t('roadmaps.editor.after')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {all
              .filter((o) => o.id !== node.id)
              .map((o) => (
                <Checkbox
                  key={o.id}
                  id={`${p}-pre-${o.id}`}
                  checked={node.prerequisites.includes(o.id)}
                  onChange={(v) =>
                    set(
                      'prerequisites',
                      v
                        ? [...node.prerequisites, o.id].slice(0, 6)
                        : node.prerequisites.filter((x) => x !== o.id),
                    )
                  }
                >
                  {o.title || o.id}
                </Checkbox>
              ))}
          </div>
        </fieldset>
      )}
      <Field label={t('roadmaps.proof')}>
        {(f) => (
          <Input
            id={f.id}
            aria-describedby={f.describedBy}
            value={node.proof}
            maxLength={300}
            onChange={(e) => set('proof', e.target.value)}
          />
        )}
      </Field>
      <RefList
        idPrefix={`${p}-res`}
        label={t('roadmaps.editor.resources')}
        items={node.resources}
        max={5}
        onChange={(v) => set('resources', v)}
      />
      <RefList
        idPrefix={`${p}-src`}
        label={t('roadmaps.editor.sources')}
        items={node.sources}
        max={6}
        onChange={(v) => set('sources', v)}
      />
      <Checkbox id={`${p}-review`} checked={node.needsReview} onChange={(v) => set('needsReview', v)}>
        {t('roadmaps.editor.needsReview')}
      </Checkbox>
    </Card>
  );
}

export function RoadmapEditorPage() {
  const { slug } = useParams();
  const existing = useQuery({
    queryKey: ['roadmap', slug],
    queryFn: () => api.get<RoadmapView>(`/roadmaps/${slug ?? ''}`),
    enabled: !!slug,
  });
  const r = existing.data;
  // Editors continue the open draft; otherwise start from the published content.
  const draftVersion = r?.draft?.version ?? null;
  const draft = useQuery({
    queryKey: ['roadmap', r?.id, 'version', draftVersion],
    queryFn: () =>
      api.get<VersionView & { content: RoadmapContent }>(
        `/roadmaps/${r?.id ?? ''}/versions/${draftVersion ?? 0}`,
      ),
    enabled: !!r && draftVersion !== null,
  });
  const source = draftVersion !== null ? draft.data?.content : r?.content;
  if (!slug) return <EditorForm initial={blank()} roadmap={null} />;
  if (!r || !source) return <Skeleton className="h-96" />;
  return (
    <EditorForm key={`${r.id}-${draftVersion ?? r.version}`} initial={structuredClone(source)} roadmap={r} />
  );
}

function EditorForm({ initial, roadmap: r }: { initial: RoadmapContent; roadmap: RoadmapView | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [content, setContent] = useState<RoadmapContent>(initial);
  const [changeNote, setChangeNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);

  const parsed = useMemo(() => roadmapContent.safeParse(content), [content]);
  const problems = parsed.success ? publishProblems(parsed.data) : [];
  const errors = !parsed.success
    ? [
        ...new Set(
          parsed.error.issues.map(
            (i) => `${i.path.join(' › ') || t('roadmaps.editor.roadmap')}: ${i.message}`,
          ),
        ),
      ].slice(0, 8)
    : [];

  const set = <K extends keyof RoadmapContent>(k: K, v: RoadmapContent[K]) =>
    setContent({ ...content, [k]: v });
  const setNodes = (nodes: RoadmapNode[]) => set('nodes', nodes);

  const save = async (submit: boolean) => {
    if (!parsed.success) {
      toast.error(t('roadmaps.editor.fixErrors'));
      return;
    }
    setBusy(true);
    try {
      let view: RoadmapView;
      if (!r) view = await api.postOnce<RoadmapView>('/roadmaps', { content: parsed.data }, key);
      else view = await api.put<RoadmapView>(`/roadmaps/${r.id}/draft`, { content: parsed.data, changeNote });
      if (submit) view = await api.post<RoadmapView>(`/roadmaps/${view.id}/submit`, {});
      qc.setQueryData(['roadmap', view.slug], view);
      void qc.invalidateQueries({ queryKey: ['roadmaps'] });
      void qc.invalidateQueries({ queryKey: ['roadmap', view.id] });
      toast.success(submit ? t('roadmaps.submitted') : t('roadmaps.saved'));
      navigate(`/roadmaps/${view.slug}`);
    } catch (e) {
      const details = e instanceof ApiError ? (e.details as { problems?: string[] } | undefined) : undefined;
      toast.error(details?.problems?.[0] ?? (e instanceof ApiError ? e.message : t('errors.generic')));
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    if (!r) return navigate('/roadmaps');
    try {
      await api.delete(`/roadmaps/${r.id}/draft`);
      void qc.invalidateQueries({ queryKey: ['roadmaps'] });
      void qc.invalidateQueries({ queryKey: ['roadmap'] });
      toast.success(t('roadmaps.discarded'));
      navigate(
        r.version && r.status !== 'draft' && r.status !== 'in_review' ? `/roadmaps/${r.slug}` : '/roadmaps',
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
    }
  };

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <div>
        <Link to={r ? `/roadmaps/${r.slug}` : '/roadmaps'} className="text-sm text-fg-3 hover:text-fg">
          ← {r ? r.title : t('roadmaps.title')}
        </Link>
        <h1 className="text-[clamp(24px,4vw,30px)] font-bold">
          {r ? t('roadmaps.editor.editTitle') : t('roadmaps.editor.newTitle')}
        </h1>
        <p className="text-fg-2">{t('roadmaps.editor.intro')}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="grid min-w-0 gap-4">
          <Card className="grid gap-3 p-4">
            <Field label={t('roadmaps.editor.title')}>
              {(f) => (
                <Input
                  id={f.id}
                  aria-describedby={f.describedBy}
                  value={content.title}
                  maxLength={100}
                  onChange={(e) => set('title', e.target.value)}
                />
              )}
            </Field>
            <Field label={t('roadmaps.editor.summary')}>
              {(f) => (
                <Textarea
                  id={f.id}
                  aria-describedby={f.describedBy}
                  value={content.summary}
                  maxLength={600}
                  rows={3}
                  onChange={(e) => set('summary', e.target.value)}
                />
              )}
            </Field>
            <Field label={t('roadmaps.category')}>
              {(f) => (
                <Select
                  id={f.id}
                  aria-describedby={f.describedBy}
                  value={content.category}
                  onChange={(e) => set('category', e.target.value as RoadmapContent['category'])}
                >
                  {ROADMAP_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`roadmaps.cat.${c}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <fieldset className="grid gap-1.5">
              <legend className="text-sm font-semibold">{t('roadmaps.editor.branches')}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {BRANCHES.map((b) => (
                  <Checkbox
                    key={b}
                    id={`rm-branch-${b}`}
                    checked={content.branches.includes(b)}
                    onChange={(v) =>
                      set('branches', v ? [...content.branches, b] : content.branches.filter((x) => x !== b))
                    }
                  >
                    {b}
                  </Checkbox>
                ))}
              </div>
            </fieldset>
            <Field label={t('roadmaps.editor.outcomes')} hint={t('roadmaps.editor.outcomesHint')}>
              {(f) => (
                <Input
                  id={f.id}
                  aria-describedby={f.describedBy}
                  defaultValue={content.outcomes.join(', ')}
                  onChange={(e) =>
                    set(
                      'outcomes',
                      e.target.value
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean)
                        .slice(0, 6),
                    )
                  }
                />
              )}
            </Field>
            <RefList
              idPrefix="rm-src"
              label={t('roadmaps.editor.roadmapSources')}
              items={content.sources}
              max={12}
              onChange={(v) => set('sources', v)}
            />
          </Card>

          <h2 className="font-display text-lg font-semibold">{t('roadmaps.editor.steps')}</h2>
          {content.nodes.map((n, i) => (
            <NodeEditor
              key={i}
              node={n}
              index={i}
              all={content.nodes}
              onChange={(next) =>
                // A renamed step keeps the other steps' prerequisites pointing at it.
                setNodes(
                  content.nodes.map((x, j) =>
                    j === i
                      ? next
                      : next.id === n.id
                        ? x
                        : { ...x, prerequisites: x.prerequisites.map((p) => (p === n.id ? next.id : p)) },
                  ),
                )
              }
              onMove={(d) => {
                const nodes = [...content.nodes];
                const [m] = nodes.splice(i, 1);
                if (m) nodes.splice(i + d, 0, m);
                setNodes(nodes);
              }}
              onRemove={() =>
                setNodes(
                  content.nodes
                    .filter((_, j) => j !== i)
                    .map((x) => ({ ...x, prerequisites: x.prerequisites.filter((p) => p !== n.id) })),
                )
              }
            />
          ))}
          {content.nodes.length < 40 && (
            <Button
              type="button"
              className="justify-self-start"
              onClick={() => setNodes([...content.nodes, blankNode(content.nodes.length + 1)])}
            >
              <Plus className="size-4" aria-hidden /> {t('roadmaps.editor.addStep')}
            </Button>
          )}
        </div>

        <aside className="grid content-start gap-3 lg:sticky lg:top-4 lg:self-start">
          <Card className="grid gap-3 p-4">
            <h2 className="font-display text-lg font-semibold">{t('roadmaps.checklist')}</h2>
            {errors.length ? (
              <ul className="list-disc pl-5 text-sm text-danger" aria-live="polite">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : problems.length ? (
              <ul className="list-disc pl-5 text-sm text-warning" aria-live="polite">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-success">{t('roadmaps.checklistOk')}</p>
            )}
            <p className="text-xs text-fg-3">{t('roadmaps.editor.rules')}</p>
            {r && (
              <Field label={t('roadmaps.editor.changeNote')}>
                {(f) => (
                  <Input
                    id={f.id}
                    aria-describedby={f.describedBy}
                    value={changeNote}
                    maxLength={300}
                    onChange={(e) => setChangeNote(e.target.value)}
                  />
                )}
              </Field>
            )}
            <Button type="submit" loading={busy}>
              {t('roadmaps.editor.saveDraft')}
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={busy}
              disabled={!!errors.length || !!problems.length}
              onClick={() => void save(true)}
            >
              <Send className="size-4" aria-hidden /> {t('roadmaps.editor.saveSubmit')}
            </Button>
            {(r?.draft || !r) && (
              <Button type="button" variant="ghost" onClick={() => void discard()}>
                {t('roadmaps.editor.discard')}
              </Button>
            )}
          </Card>
        </aside>
      </div>
    </form>
  );
}
