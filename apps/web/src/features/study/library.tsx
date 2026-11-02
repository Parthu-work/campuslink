import { lazy, Suspense, useDeferredValue, useId, useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, FileText, Loader, Plus, Search } from 'lucide-react';
import {
  MATERIAL_TABS,
  type MaterialTab,
  type MaterialView,
  type SubjectView,
  type SyllabusUnitView,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Sheet } from '../../components/ui/dialog';
import { Input, Select } from '../../components/ui/field';
import { Illustration } from '../../components/ui/illustration';
import { IntentLink } from '../../components/ui/intent-link';
import { MATERIAL_ICONS } from '../../lib/material-icons';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { api, ApiError } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { materials, studySearch } from '../../lib/queries';
import { formatDuration } from '../../lib/study';
import { useMaterialProgress } from '../../lib/material-progress';
import { toast } from '../../lib/toast';
import { useUrlOverlay } from '../../lib/use-url-overlay';

// The upload form loads when opened (bundle budget).
const UploadSheet = lazy(() => import('./upload-sheet').then((m) => ({ default: m.UploadSheet })));

/** Where processing is, for the uploader and managers ("indexed" shows nothing). */
function StatusChip({ m }: { m: MaterialView }) {
  const { t } = useTranslation();
  const live = useMaterialProgress((s) => s.byId[m.id]);
  const stage = live?.stage ?? m.stage;
  if (m.visibility === 'in_review') return <Badge tone="info">{t('study.status.in_review')}</Badge>;
  if (m.visibility === 'draft') return <Badge tone="warning">{t('study.status.sent_back')}</Badge>;
  if (stage === 'failed')
    return (
      <Badge tone="danger">
        <CircleAlert aria-hidden /> {t('study.status.failed')}
      </Badge>
    );
  if (stage !== 'indexed')
    return (
      <Badge tone="brand">
        <Loader className="motion-safe:animate-spin" aria-hidden /> {t(`study.stage.${stage}`)}
      </Badge>
    );
  return null;
}

export function MaterialCard({ m }: { m: MaterialView }) {
  const { t } = useTranslation();
  const Icon = MATERIAL_ICONS[m.type];
  const facts = [
    t(`study.type.${m.type}`),
    m.pageCount ? t('study.pages', { count: m.pageCount }) : '',
    m.durationSec ? formatDuration(m.durationSec) : '',
    m.uploader.name,
    formatRelative(m.createdAt),
  ].filter(Boolean);
  return (
    <Card variant="interactive" className="relative flex h-full gap-3 p-4">
      <span
        aria-hidden
        className="grid size-11 flex-none place-items-center rounded-[var(--radius-md)] bg-brand-surface text-brand-ink"
      >
        <Icon className="size-5" />
      </span>
      <div className="grid min-w-0 flex-1 content-start gap-1">
        <IntentLink
          to={`/study/${m.subjectId}/m/${m.id}`}
          className="leading-snug font-semibold after:absolute after:inset-0 hover:underline"
        >
          {m.title}
        </IntentLink>
        <p className="truncate text-caption text-fg-3">{facts.join(' · ')}</p>
        {(m.can.edit || m.can.review) && (
          <span className="flex flex-wrap gap-1.5">
            <StatusChip m={m} />
          </span>
        )}
      </div>
    </Card>
  );
}

/** Contributions waiting for an owner or admin: publish, or send back with a note. */
function ReviewQueue({ subjectId }: { subjectId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery(materials(subjectId, { status: 'in_review' }));
  const review = useMutation({
    mutationFn: (v: { id: string; action: 'publish' | 'reject' }) =>
      api.post<MaterialView>(`/study/materials/${v.id}/review`, { action: v.action }),
    onSuccess: (_m, v) => {
      void qc.invalidateQueries({ queryKey: ['materials', subjectId] });
      toast.success(v.action === 'publish' ? t('study.review.published') : t('study.review.sentBack'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  if (!q.data?.length) return null;
  return (
    <Card className="grid gap-3 border-info-border bg-info-surface p-4" aria-labelledby="review-h">
      <h3 id="review-h" className="font-semibold">
        {t('study.review.title', { count: q.data.length })}
      </h3>
      <ul className="grid gap-2">
        {q.data.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-surface-1 p-3"
          >
            <IntentLink
              to={`/study/${subjectId}/m/${m.id}`}
              className="min-w-0 flex-1 font-semibold hover:underline"
            >
              {m.title}
            </IntentLink>
            <span className="text-caption text-fg-3">{m.uploader.name}</span>
            <Button
              size="sm"
              variant="primary"
              loading={review.isPending && review.variables.id === m.id}
              onClick={() => review.mutate({ id: m.id, action: 'publish' })}
            >
              {t('study.review.publish')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => review.mutate({ id: m.id, action: 'reject' })}>
              {t('study.review.sendBack')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * A subject's library (spec §10): Notes, Slides, Videos, Past papers and Other, filtered by unit
 * and topic, with keyword search inside the subject. Uploaders and managers see processing status.
 */
export function SubjectLibrary({ subject, units }: { subject: SubjectView; units: SyllabusUnitView[] }) {
  const { t } = useTranslation();
  const idBase = useId();
  const sheet = useUrlOverlay('add');
  const [tab, setTab] = useState<MaterialTab>('notes');
  const [unitId, setUnitId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [text, setText] = useState('');
  const q = useDeferredValue(text.trim());
  const list = useQuery({ ...materials(subject.id, { unitId, topicId }), placeholderData: keepPreviousData });
  const hits = useQuery(studySearch(q, subject.id));
  const topics = (unitId ? units.filter((u) => u.id === unitId) : units).flatMap((u) => u.topics);
  const rows = list.data ?? [];
  const inTab = rows.filter((m) => m.category === tab);

  return (
    <section aria-labelledby="library-title" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="library-title" className="flex items-center gap-2 text-title font-semibold">
          <FileText className="size-5 text-brand-ink" aria-hidden /> {t('study.library')}
        </h2>
        {subject.can.upload && (
          <Button variant="primary" size="sm" onClick={() => sheet.open('files')}>
            <Plus className="size-4" aria-hidden /> {t('study.addMaterial')}
          </Button>
        )}
      </div>
      {subject.can.manage && <ReviewQueue subjectId={subject.id} />}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr]">
        <Select
          size="sm"
          aria-label={t('study.filter.unit')}
          value={unitId}
          onChange={(e) => (setUnitId(e.target.value), setTopicId(''))}
        >
          <option value="">{t('study.filter.allUnits')}</option>
          {units.map((u, i) => (
            <option key={u.id} value={u.id}>
              {t('study.unit', { n: i + 1 })}: {u.title}
            </option>
          ))}
        </Select>
        <Select
          size="sm"
          aria-label={t('study.filter.topic')}
          value={topicId}
          onChange={(e) => setTopicId(e.target.value)}
        >
          <option value="">{t('study.filter.allTopics')}</option>
          {topics.map((tp) => (
            <option key={tp.id} value={tp.id}>
              {tp.title}
            </option>
          ))}
        </Select>
        <label className="relative">
          <span className="sr-only">{t('study.searchMaterial')}</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3"
            aria-hidden
          />
          <Input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('study.searchMaterial')}
            className="min-h-11 pl-9 text-meta"
          />
        </label>
      </div>
      {q.length >= 2 ? (
        <Card className="p-2" aria-live="polite">
          {hits.isLoading ? (
            <Skeleton className="m-2 h-20" />
          ) : hits.data?.length ? (
            <ul className="grid">
              {hits.data.map((h) => (
                <li key={h.chunkId}>
                  <IntentLink
                    to={`/study/${h.subjectId}/m/${h.materialId}?${h.startSec !== null ? `t=${Math.floor(h.startSec)}` : h.page ? `page=${h.page}` : ''}&q=${encodeURIComponent(q)}`}
                    className="grid gap-0.5 rounded-[var(--radius-md)] p-3 hover:bg-hover"
                  >
                    <span className="font-semibold">{h.title}</span>
                    <span className="text-caption text-fg-3">
                      {[
                        h.startSec !== null
                          ? formatDuration(h.startSec)
                          : h.page
                            ? t('study.pageN', { n: h.page })
                            : '',
                        // Found by meaning only: the words differ, so say why it is here.
                        h.match === 'semantic' ? t('study.match.semantic') : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span className="text-meta text-fg-2">{h.snippet}</span>
                  </IntentLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-3 text-meta text-fg-2">{t('study.noHits')}</p>
          )}
        </Card>
      ) : (
        <Card className="grid gap-3 px-3 pt-1 pb-3 sm:px-4">
          <Tabs<MaterialTab>
            label={t('study.library')}
            idBase={idBase}
            value={tab}
            onChange={setTab}
            tabs={MATERIAL_TABS.map((id) => ({
              id,
              label: t(`study.tab.${id}`),
              count: rows.filter((m) => m.category === id).length,
            }))}
          />
          <TabPanel idBase={idBase} id={tab}>
            {list.isLoading ? (
              <Skeleton className="h-24" />
            ) : inTab.length ? (
              <ul className="grid gap-2 md:grid-cols-2">
                {inTab.map((m) => (
                  <li key={m.id} className="min-w-0">
                    <MaterialCard m={m} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState art={<Illustration kind="study" size={88} />} title={t(`study.emptyTab.${tab}`)}>
                {subject.can.upload ? t('study.emptyTabUpload') : t('study.noMaterialBody')}
              </EmptyState>
            )}
          </TabPanel>
        </Card>
      )}
      {subject.can.upload && (
        <Sheet
          open={sheet.value?.split(':')[0] === 'files' || sheet.value === 'link'}
          onOpenChange={(o) => !o && sheet.close()}
          title={t('study.addMaterial')}
          history={false}
        >
          <Suspense fallback={<Skeleton className="h-96" />}>
            <UploadSheet subject={subject} units={units} />
          </Suspense>
        </Sheet>
      )}
    </section>
  );
}
