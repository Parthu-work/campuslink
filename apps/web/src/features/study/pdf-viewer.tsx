import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, Sparkles, ZoomIn, ZoomOut } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, Util, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { MaterialDetailView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/field';
import { Card, Skeleton } from '../../components/ui/misc';
import { materialFile } from '../../lib/queries';

GlobalWorkerOptions.workerSrc = workerUrl;

interface TextItem {
  str: string;
  width: number;
  transform: number[];
}

/**
 * The in-app PDF viewer (pdf.js in its own chunk, worker from our origin): page by page with
 * previous/next and a page number, zoom, search across the extracted text, highlights of the
 * searched words (or a citation's passage), and the page's text for screen readers and copying.
 */
export function PdfViewer({
  m,
  initialPage,
  highlight,
  onAsk,
}: {
  m: MaterialDetailView;
  initialPage: number | null;
  highlight: string;
  /** "Ask about this page" (the study assistant). */
  onAsk?: ((page: number) => void) | undefined;
}) {
  const { t } = useTranslation();
  const file = useQuery(materialFile(m.id));
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(initialPage ?? 1);
  const [zoom, setZoom] = useState(1);
  const [query, setQuery] = useState(highlight);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const marks = useRef<HTMLCanvasElement>(null);
  const count = doc?.numPages ?? m.pageCount ?? 1;
  const words = useMemo(
    () =>
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2),
    [query],
  );
  const found = useMemo(
    () =>
      words.length
        ? m.pages.filter((p) => words.some((w) => p.text.toLowerCase().includes(w))).map((p) => p.page)
        : [],
    [m.pages, words],
  );

  useEffect(() => {
    if (!file.data) return;
    let cancelled = false;
    let task: ReturnType<typeof getDocument> | null = null;
    void (async () => {
      try {
        const res = await fetch(file.data.url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('fetch');
        task = getDocument({ data: new Uint8Array(await res.arrayBuffer()), enableXfa: false });
        const pdf = await task.promise;
        if (!cancelled) setDoc(pdf);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [file.data]);

  useEffect(() => {
    if (!doc || !canvas.current || !marks.current || !box.current) return;
    let cancelled = false;
    const c = canvas.current;
    const o = marks.current;
    void (async () => {
      const p = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
      const base = p.getViewport({ scale: 1 });
      const scale = ((box.current?.clientWidth ?? base.width) / base.width) * zoom;
      const vp = p.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      for (const el of [c, o]) {
        el.width = Math.floor(vp.width * dpr);
        el.height = Math.floor(vp.height * dpr);
        el.style.width = `${Math.floor(vp.width)}px`;
        el.style.height = `${Math.floor(vp.height)}px`;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      await p.render({
        canvas: c,
        canvasContext: ctx,
        viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      }).promise;
      if (cancelled) return;
      const mctx = o.getContext('2d');
      if (!mctx) return;
      mctx.clearRect(0, 0, o.width, o.height);
      if (!words.length) return;
      const content = await p.getTextContent();
      mctx.fillStyle =
        getComputedStyle(document.documentElement).getPropertyValue('--warning').trim() || 'yellow';
      mctx.globalAlpha = 0.35;
      for (const item of content.items as TextItem[]) {
        if (!item.str || !words.some((w) => item.str.toLowerCase().includes(w))) continue;
        const tx = Util.transform(vp.transform, item.transform);
        const h = Math.hypot(tx[2] ?? 0, tx[3] ?? 0);
        mctx.fillRect((tx[4] ?? 0) * dpr, ((tx[5] ?? 0) - h) * dpr, item.width * scale * dpr, h * 1.15 * dpr);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, page, zoom, words]);

  const go = (n: number) => setPage(Math.min(Math.max(1, n), count));
  const text = m.pages.find((p) => p.page === page)?.text ?? '';

  if (failed) return <p className="text-meta text-danger">{t('study.viewer.pdfFailed')}</p>;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          aria-label={t('study.viewer.prev')}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <label className="flex items-center gap-1.5 text-meta">
          <span className="sr-only">{t('study.viewer.pageNumber')}</span>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={count}
            value={page}
            onChange={(e) => go(Number(e.target.value) || 1)}
            className="min-h-11 w-20 text-center"
          />
          <span className="text-fg-3">{t('study.viewer.ofPages', { count })}</span>
        </label>
        <Button
          variant="outline"
          size="sm"
          onClick={() => go(page + 1)}
          disabled={page >= count}
          aria-label={t('study.viewer.next')}
        >
          <ChevronRight className="size-4" aria-hidden />
        </Button>
        <span className="mx-1 h-6 w-px bg-line" aria-hidden />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          aria-label={t('study.viewer.zoomOut')}
        >
          <ZoomOut className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
          aria-label={t('study.viewer.zoomIn')}
        >
          <ZoomIn className="size-4" aria-hidden />
        </Button>
        {onAsk && (
          <Button variant="ghost" size="sm" onClick={() => onAsk(page)}>
            <Sparkles className="size-4" aria-hidden /> {t('study.chat.askAboutPage')}
          </Button>
        )}
        <label className="relative ml-auto min-w-0 basis-56">
          <span className="sr-only">{t('study.viewer.searchPdf')}</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('study.viewer.searchPdf')}
            className="min-h-11 pl-9 text-meta"
          />
        </label>
      </div>
      {words.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-meta" aria-live="polite">
          {found.length ? t('study.viewer.foundOn') : t('study.viewer.noMatch')}
          {found.slice(0, 30).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => go(n)}
              aria-current={n === page ? 'page' : undefined}
              className="min-h-9 min-w-9 rounded-full border border-line-strong px-2 text-caption aria-[current=page]:bg-brand-surface"
            >
              {n}
            </button>
          ))}
        </p>
      )}
      <Card className="overflow-auto bg-surface-2 p-2">
        <div
          ref={box}
          tabIndex={0}
          role="group"
          aria-label={t('study.viewer.pageOf', { page, count })}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'PageDown') go(page + 1);
            if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(page - 1);
          }}
          className="relative mx-auto w-full max-w-[900px]"
        >
          {!doc && <Skeleton className="aspect-[3/4] w-full" />}
          <canvas ref={canvas} aria-hidden className={doc ? 'block shadow-elev-2' : 'hidden'} />
          <canvas ref={marks} aria-hidden className="pointer-events-none absolute top-0 left-0" />
        </div>
      </Card>
      {text && (
        <details className="rounded-[var(--radius-md)] border border-line p-3 text-meta">
          <summary className="cursor-pointer py-3 font-semibold">{t('study.viewer.pageText')}</summary>
          <p className="mt-2 whitespace-pre-line text-fg-2">{text}</p>
        </details>
      )}
    </div>
  );
}
