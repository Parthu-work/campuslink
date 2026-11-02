import { lazy, Suspense, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Download, Loader, Pencil, RotateCcw, Sparkles } from 'lucide-react';
import type { MaterialDetailView, MaterialView } from '@campuslink/shared';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { Sheet } from '../../components/ui/dialog';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { ProgressBar } from '../../components/ui/progress';
import { api, ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { findCached, hasId } from '../../lib/query-seed';
import { material as materialQuery, materialFile, subject as subjectQuery } from '../../lib/queries';
import { formatDuration } from '../../lib/study';
import { useMaterialProgress } from '../../lib/material-progress';
import { toast } from '../../lib/toast';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { LinkPlayer, MediaPlayer } from './media-player';
import { ChatLauncher } from './chat/chat-launcher';
import type { AskContext } from '../../lib/chat';
import { SCREEN } from '../../lib/query-client';

// pdf.js and its worker load only when a PDF is opened; the editor only when it is opened.
const PdfViewer = lazy(() => import('./pdf-viewer').then((m) => ({ default: m.PdfViewer })));
const MaterialEditor = lazy(() => import('./material-editor').then((m) => ({ default: m.MaterialEditor })));

/** Pages or slides of extracted text, with the searched words marked. */
function TextPages({ m, highlight }: { m: MaterialDetailView; highlight: string }) {
  const { t } = useTranslation();
  const words = highlight
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const mark = (text: string) => {
    if (!words.length) return text;
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    return text.split(re).map((part, i) =>
      i % 2 ? (
        <mark key={i} className="rounded-[var(--radius-xs)] bg-warning-surface text-fg">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };
  if (!m.pages.length) return <p className="text-meta text-fg-3">{t('study.viewer.noText')}</p>;
  return (
    <div className="grid gap-3">
      {m.pages.map((p) => (
        <Card key={p.page} className="grid gap-2 p-4" id={`page-${p.page}`}>
          {m.pages.length > 1 && (
            <h2 className="eyebrow">
              {m.type === 'slides'
                ? t('study.viewer.slideN', { n: p.page })
                : t('study.pageN', { n: p.page })}
            </h2>
          )}
          <p className="max-w-[72ch] whitespace-pre-line">{mark(p.text)}</p>
        </Card>
      ))}
    </div>
  );
}

function DownloadButton({ m }: { m: MaterialDetailView }) {
  const { t } = useTranslation();
  const file = useQuery({ ...materialFile(m.id), enabled: !!m.mime });
  if (!file.data) return null;
  return (
    <a
      href={file.data.url}
      download
      className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-line-strong px-4 text-meta font-semibold hover:bg-hover"
    >
      <Download className="size-4" aria-hidden /> {t('study.viewer.download')}
    </a>
  );
}

function SignedImage({ m }: { m: MaterialDetailView }) {
  const file = useQuery(materialFile(m.id));
  if (!file.data) return <Skeleton className="aspect-video w-full" />;
  return (
    <img
      src={file.data.url}
      alt={m.title}
      className="max-h-[80vh] w-auto rounded-[var(--radius-lg)] shadow-elev-1"
    />
  );
}

/** Where processing is, why it failed, or what is missing (uploader and managers). */
function Status({ m }: { m: MaterialDetailView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const live = useMaterialProgress((s) => s.byId[m.id]);
  const stage = live?.stage ?? m.stage;
  const progress = live?.progress ?? m.progress;
  const error = live?.error ?? m.error;
  const again = useMutation({
    mutationFn: () => api.post<MaterialDetailView>(`/study/materials/${m.id}/reprocess`),
    onSuccess: (v) => qc.setQueryData(['material', m.id], v),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  if (!m.can.edit && !m.can.review) return null;
  if (stage !== 'indexed' && stage !== 'failed')
    return (
      <Card className="grid gap-2 p-4" role="status">
        <p className="flex items-center gap-2 text-meta font-semibold">
          <Loader className="size-4 motion-safe:animate-spin" aria-hidden /> {t(`study.stage.${stage}`)}
        </p>
        <ProgressBar value={progress} max={100} label={t('study.viewer.processing')} />
      </Card>
    );
  if (stage === 'failed' || error)
    return (
      <Card
        className={
          stage === 'failed'
            ? 'flex flex-wrap items-center gap-3 border-danger-border bg-danger-surface p-4'
            : 'flex flex-wrap items-center gap-3 bg-warning-surface p-4'
        }
        role="status"
      >
        <CircleAlert className="size-5 flex-none" aria-hidden />
        <p className="min-w-0 flex-1 text-meta">{error ?? t('study.status.failed')}</p>
        {m.can.edit && (
          <Button variant="outline" size="sm" loading={again.isPending} onClick={() => again.mutate()}>
            <RotateCcw className="size-4" aria-hidden /> {t('study.viewer.reprocess')}
          </Button>
        )}
      </Card>
    );
  return null;
}

/**
 * One piece of material (spec §10): the right viewer for its type, its source and uploader, and
 * for the uploader and managers its processing status and an edit sheet. `?page=` and `?t=` open
 * a PDF page or a moment in a video (citations and search results link here), `?q=` highlights.
 */
export function MaterialPage() {
  const { id = '', materialId = '' } = useParams();
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const editor = useUrlOverlay('edit');
  const askSheet = useUrlOverlay('ask');
  const [ask, setAsk] = useState<AskContext | null>(null);
  const page = Number(params.get('page')) || null;
  const start = Number(params.get('t')) || null;
  const highlight = params.get('q') ?? '';
  const subj = useQuery(subjectQuery(id));
  const q = useQuery({
    ...SCREEN,
    ...materialQuery(materialId),
    // The library row draws the header at once.
    placeholderData: () => {
      const row = findCached(qc, [['materials']], hasId<MaterialView>('id', materialId, ['title', 'type']));
      return row ? { ...row, chapters: [], transcript: [], pages: [] } : undefined;
    },
  });
  const back = <BackLink to={`/study/${id}`}>{subj.data?.name ?? t('study.back')}</BackLink>;
  if (q.isLoading)
    return (
      <div className="grid gap-4">
        {back}
        <Skeleton className="h-64 rounded-[var(--radius-xl)]" />
      </div>
    );
  if (!q.data)
    return (
      <div className="grid gap-4">
        {back}
        <EmptyState art={<Illustration kind="study" />} title={t('study.viewer.notFound')}>
          {t('study.viewer.notFoundBody')}
        </EmptyState>
      </div>
    );
  const m = q.data;
  // "Ask about this": what the member is looking at (and any words they selected) goes to the chat.
  const askAbout = (where: { page?: number | null; startSec?: number | null }) => {
    const selected = window.getSelection()?.toString().trim().slice(0, 1500) ?? '';
    setAsk({
      materialId: m.id,
      title: m.title,
      page: where.page ?? null,
      startSec: where.startSec ?? null,
      text: selected,
    });
    askSheet.open('1');
  };
  const facts = [
    t(`study.type.${m.type}`),
    m.pageCount ? t('study.pages', { count: m.pageCount }) : '',
    m.durationSec ? formatDuration(m.durationSec) : '',
    t('study.viewer.sharedBy', { name: m.uploader.name }),
    formatDateTime(m.createdAt),
    m.version > 1 ? t('study.viewer.version', { n: m.version }) : '',
  ].filter(Boolean);
  return (
    <div className="grid gap-5">
      {back}
      <PageHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2">
            {t(`study.tab.${m.category}`)}
            {m.visibility === 'in_review' && <Badge tone="info">{t('study.status.in_review')}</Badge>}
            {m.visibility === 'draft' && <Badge tone="warning">{t('study.status.sent_back')}</Badge>}
          </span>
        }
        title={m.title}
        intro={m.description || undefined}
        actions={
          m.can.edit && (
            <Button variant="outline" size="sm" onClick={() => editor.open('details')}>
              <Pencil className="size-4" aria-hidden /> {t('study.viewer.edit')}
            </Button>
          )
        }
      />
      <p className="text-meta text-fg-2">{facts.join(' · ')}</p>
      {m.visibility === 'draft' && m.reviewNote && (
        <p className="rounded-[var(--radius-md)] bg-warning-surface p-3 text-meta">
          {t('study.viewer.reviewNote', { note: m.reviewNote })}
        </p>
      )}
      <Status m={m} />
      {m.type === 'pdf' ? (
        <Suspense fallback={<Skeleton className="aspect-[3/4] w-full max-w-[900px]" />}>
          <PdfViewer
            m={m}
            initialPage={page}
            highlight={highlight}
            onAsk={m.visibility === 'published' ? (p) => askAbout({ page: p }) : undefined}
          />
        </Suspense>
      ) : m.type === 'video_file' || m.type === 'audio' ? (
        <MediaPlayer
          m={m}
          start={start}
          highlight={highlight}
          onAsk={m.visibility === 'published' ? (sec) => askAbout({ startSec: sec }) : undefined}
        />
      ) : m.type === 'video_link' ? (
        <LinkPlayer
          m={m}
          start={start}
          highlight={highlight}
          onAsk={m.visibility === 'published' ? (sec) => askAbout({ startSec: sec }) : undefined}
        />
      ) : m.type === 'image' ? (
        <SignedImage m={m} />
      ) : (
        <div className="grid gap-3">
          {m.visibility === 'published' && m.pages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => askAbout({ page: m.pages[0]?.page ?? 1 })}
            >
              <Sparkles className="size-4" aria-hidden /> {t('study.chat.askAboutThis')}
            </Button>
          )}
          <TextPages m={m} highlight={highlight} />
        </div>
      )}
      {m.mime && m.type !== 'image' && <DownloadButton m={m} />}
      <p className="text-caption text-fg-3">{t('study.viewer.rightsNote')}</p>
      {m.visibility === 'published' && <ChatLauncher subjectId={id} context={ask} />}
      {m.can.edit && (
        <Sheet
          open={editor.value === 'details'}
          onOpenChange={(o) => !o && editor.close()}
          title={t('study.viewer.edit')}
          history={false}
        >
          <Suspense fallback={<Skeleton className="h-96" />}>
            <MaterialEditor m={m} subjectId={id} onDone={() => editor.close()} />
          </Suspense>
        </Sheet>
      )}
    </div>
  );
}
