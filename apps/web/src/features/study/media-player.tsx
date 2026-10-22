import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import type { MaterialDetailView } from '@campuslink/shared';
import { Card, Skeleton } from '../../components/ui/misc';
import { Segmented } from '../../components/ui/tab-nav';
import { materialFile } from '../../lib/queries';
import { formatDuration } from '../../lib/study';
import { cn } from '../../lib/cn';

const SPEEDS = ['0.75', '1', '1.25', '1.5', '2'] as const;

/** Chapters and the transcript, each line a button that jumps to its moment. */
function Timeline({
  m,
  current,
  onSeek,
  highlight,
}: {
  m: MaterialDetailView;
  current: number;
  onSeek: (sec: number) => void;
  highlight: string;
}) {
  const { t } = useTranslation();
  const active = m.transcript.findLastIndex((s) => s.start <= current + 0.25);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const words = highlight
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return (
    <div className="grid content-start gap-4">
      {m.chapters.length > 0 && (
        <section aria-labelledby="chapters-h" className="grid gap-2">
          <h2 id="chapters-h" className="eyebrow">
            {t('study.viewer.chapters')}
          </h2>
          <ol className="flex flex-wrap gap-2">
            {m.chapters.map((c) => (
              <li key={`${c.at}-${c.title}`}>
                <button
                  type="button"
                  onClick={() => onSeek(c.at)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line-strong px-3 text-meta hover:bg-hover"
                >
                  <span className="font-mono text-caption text-fg-3">{formatDuration(c.at)}</span> {c.title}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section aria-labelledby="transcript-h" className="grid gap-2">
        <h2 id="transcript-h" className="eyebrow">
          {t('study.viewer.transcript')}
        </h2>
        {m.transcript.length ? (
          <ol
            ref={list}
            className="grid max-h-[50vh] gap-0.5 overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-line p-1"
          >
            {m.transcript.map((s, i) => (
              <li key={`${s.start}-${i}`}>
                <button
                  type="button"
                  aria-current={i === active ? 'true' : undefined}
                  onClick={() => onSeek(s.start)}
                  className={cn(
                    'grid w-full grid-cols-[3.5rem_1fr] gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-meta hover:bg-hover',
                    i === active && 'bg-brand-surface',
                    words.some((w) => s.text.toLowerCase().includes(w)) && 'font-semibold',
                  )}
                >
                  <span className="font-mono text-caption text-fg-3">{formatDuration(s.start)}</span>
                  <span>{s.text}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-meta text-fg-3">{t('study.viewer.noTranscript')}</p>
        )}
      </section>
    </div>
  );
}

/**
 * An uploaded video or audio file: the native player (keyboard, captions, picture in picture),
 * playback speed, chapters and a transcript that follows playback and jumps on click. The file
 * comes through a five-minute signed link; when it lapses mid-play the player re-signs and resumes.
 */
export function MediaPlayer({
  m,
  start,
  highlight,
}: {
  m: MaterialDetailView;
  start: number | null;
  highlight: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const file = useQuery(materialFile(m.id));
  const el = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [now, setNow] = useState(start ?? 0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>('1');
  const resume = useRef<{ at: number; play: boolean } | null>(start ? { at: start, play: false } : null);

  useEffect(() => {
    if (el.current) el.current.playbackRate = Number(speed);
  }, [speed]);

  const seek = (sec: number) => {
    const v = el.current;
    if (!v) return;
    v.currentTime = sec;
    void v.play().catch(() => undefined);
  };
  if (!file.data) return <Skeleton className="aspect-video w-full rounded-[var(--radius-lg)]" />;
  const Tag = m.type === 'audio' ? 'audio' : 'video';
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-3">
        <Tag
          ref={el}
          src={file.data.url}
          controls
          preload="metadata"
          className={cn('w-full rounded-[var(--radius-lg)] bg-space', Tag === 'video' && 'aspect-video')}
          onLoadedMetadata={(e) => {
            const r = resume.current;
            if (r) {
              e.currentTarget.currentTime = r.at;
              if (r.play) void e.currentTarget.play().catch(() => undefined);
              resume.current = null;
            }
            e.currentTarget.playbackRate = Number(speed);
          }}
          onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
          onError={(e) => {
            // The signed link expired: get a fresh one and carry on from the same moment.
            resume.current = { at: e.currentTarget.currentTime, play: !e.currentTarget.paused };
            void qc.invalidateQueries({ queryKey: ['material-file', m.id] });
          }}
        >
          {t('study.viewer.noMediaSupport')}
        </Tag>
        <Segmented<(typeof SPEEDS)[number]>
          label={t('study.viewer.speed')}
          value={speed}
          onChange={setSpeed}
          options={SPEEDS.map((s) => [s, `${s}×`] as const)}
          className="w-full sm:w-auto"
        />
      </div>
      <Timeline m={m} current={now} onSeek={seek} highlight={highlight} />
    </div>
  );
}

/**
 * A YouTube or Vimeo video behind a click-to-load facade: nothing is requested from the provider
 * until the student taps play (privacy-enhanced embed, no thumbnail fetched from them).
 */
export function LinkPlayer({
  m,
  start,
  highlight,
}: {
  m: MaterialDetailView;
  start: number | null;
  highlight: string;
}) {
  const { t } = useTranslation();
  const [at, setAt] = useState<number | null>(null);
  const link = m.link;
  if (!link) return null;
  const src = (sec: number) =>
    link.provider === 'youtube'
      ? `${link.embedUrl}?autoplay=1&rel=0&start=${Math.floor(sec)}`
      : `${link.embedUrl}&autoplay=1#t=${Math.floor(sec)}s`;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-2">
        {at === null ? (
          <Card className="relative grid aspect-video place-items-center overflow-hidden bg-space text-on-space">
            <button
              type="button"
              onClick={() => setAt(start ?? 0)}
              className="grid justify-items-center gap-3 p-6 text-center"
              aria-label={t('study.viewer.playFrom', {
                provider: t(`study.provider.${link.provider}`),
                title: m.title,
              })}
            >
              <span className="grid size-16 place-items-center rounded-full bg-brand text-on-brand shadow-elev-3">
                <Play className="size-7 translate-x-0.5" aria-hidden />
              </span>
              <span className="text-body font-semibold">{m.title}</span>
              <span className="text-caption text-on-space-2">
                {[link.author, m.durationSec ? formatDuration(m.durationSec) : '']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          </Card>
        ) : (
          <iframe
            key={at}
            src={src(at)}
            title={m.title}
            className="aspect-video w-full rounded-[var(--radius-lg)] border-0 bg-space"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        )}
        <p className="text-caption text-fg-3">{t(`study.viewer.facadeNote.${link.provider}`)}</p>
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit text-meta font-semibold text-brand-ink hover:underline"
        >
          {t('study.viewer.openOn', { provider: t(`study.provider.${link.provider}`) })}
        </a>
      </div>
      <Timeline m={m} current={at ?? 0} onSeek={(s) => setAt(s)} highlight={highlight} />
    </div>
  );
}
