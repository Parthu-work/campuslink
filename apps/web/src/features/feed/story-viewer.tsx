/* The full-screen story viewer, loaded when a ring is opened (Home's first paint needs only the rings). */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog as D } from 'radix-ui';
import { toast } from '../../lib/toast';
import { ChevronLeft, ChevronRight, ExternalLink, Pause, Play, Trash2, X } from 'lucide-react';
import { type StoryView } from '@campuslink/shared';
import { Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { api, ApiError } from '../../lib/api';
import { useDialogHistory } from '../../lib/use-dialog-history';
import { useFileUrl } from '../../lib/files';
import { formatRelative } from '../../lib/format';
import { markStorySeen, STORY_MS, storyBackground, type StoryGroup } from '../../lib/stories';

function StoryFace({ story }: { story: StoryView }) {
  const url = useFileUrl(story.fileId);
  if (story.kind === 'photo')
    return (
      <div className="relative grid size-full place-items-center bg-black">
        {url ? (
          <img src={url} alt={story.alt} className="max-h-full max-w-full object-contain" />
        ) : (
          <Skeleton className="size-full" />
        )}
        {story.text && (
          <p className="absolute inset-x-4 bottom-20 rounded-[var(--radius-sm)] bg-[var(--scrim)] p-3 text-center text-title font-semibold text-white">
            {story.text}
          </p>
        )}
      </div>
    );
  return (
    <div
      className="grid size-full place-items-center p-8"
      style={{ background: storyBackground[story.background ?? 'brand'] }}
    >
      <p className="max-w-[22ch] text-center font-display text-[clamp(24px,6vw,34px)] leading-tight font-bold text-white">
        {story.text}
      </p>
    </div>
  );
}

export function StoryViewer({
  groups,
  start,
  onClose,
}: {
  groups: StoryGroup[];
  start: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // Back (or the Android back gesture) closes the viewer.
  const requestChange = useDialogHistory(true, (o) => !o && onClose());
  const [g, setG] = useState(start);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const group = groups[g];
  const story = group?.stories[i];
  useEffect(() => {
    if (story) markStorySeen(story.id);
  }, [story]);
  const next = useCallback(() => {
    if (!group) return;
    if (i + 1 < group.stories.length) setI(i + 1);
    else if (g + 1 < groups.length) {
      setG(g + 1);
      setI(0);
    } else onClose();
  }, [g, i, group, groups.length, onClose]);
  const prev = () => {
    if (i > 0) setI(i - 1);
    else if (g > 0) {
      setG(g - 1);
      setI((groups[g - 1]?.stories.length ?? 1) - 1);
    }
  };
  // Auto-advance runs on the compositor: the active segment's CSS animation lasts STORY_MS and its
  // end moves on (audit MO-4). Pausing (button, Space, holding the story) pauses the animation, which
  // keeps its place (WCAG 2.2.2).
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/stories/${id}`),
    onSuccess: () => {
      toast.success(t('stories.deleted'));
      void qc.invalidateQueries({ queryKey: ['stories'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  if (!group || !story) return null;
  return (
    <D.Root open onOpenChange={requestChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[90] bg-black/90" />
        <D.Content
          aria-describedby={undefined}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') next();
            else if (e.key === 'ArrowLeft') prev();
            else if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON') {
              e.preventDefault();
              setPaused((p) => !p);
            }
          }}
          className="fixed inset-0 z-[91] mx-auto flex h-dvh w-full max-w-[480px] flex-col overflow-hidden bg-black text-white sm:my-[3vh] sm:h-[94dvh] sm:rounded-[var(--radius-lg)]"
        >
          <D.Title className="sr-only">{t('stories.viewerTitle', { name: group.author.name })}</D.Title>
          <div className="absolute inset-x-0 top-0 z-10 grid gap-3 bg-gradient-to-b from-black/70 to-transparent p-3 pb-8">
            <div className="flex gap-1" aria-hidden>
              {group.stories.map((s, j) => (
                <span key={s.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                  {j === i ? (
                    <span
                      key={story.id}
                      className="story-progress block h-full origin-left bg-white"
                      style={{
                        animationDuration: `${STORY_MS}ms`,
                        animationPlayState: paused ? 'paused' : 'running',
                      }}
                      onAnimationEnd={next}
                    />
                  ) : (
                    <span
                      className="block h-full origin-left bg-white"
                      style={{ transform: `scaleX(${j < i ? 1 : 0})` }}
                    />
                  )}
                </span>
              ))}
            </div>
            <p className="sr-only" aria-live="polite">
              {t('stories.position', { n: i + 1, total: group.stories.length, name: group.author.name })}
            </p>
            <div className="flex items-center gap-2">
              <PersonAvatar name={group.author.name || '?'} fileId={group.author.avatarFileId} size={34} />
              <p className="min-w-0 flex-1 truncate text-meta">
                <b>{group.author.name}</b>{' '}
                <span className="text-white/80">{formatRelative(story.createdAt)}</span>
              </p>
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? t('stories.play') : t('stories.pause')}
                className="grid size-11 place-items-center rounded-full hover:bg-white/15"
              >
                {paused ? <Play className="size-5" aria-hidden /> : <Pause className="size-5" aria-hidden />}
              </button>
              {story.isMine && (
                <button
                  type="button"
                  onClick={() => remove.mutate(story.id)}
                  aria-label={t('stories.delete')}
                  className="grid size-11 place-items-center rounded-full hover:bg-white/15"
                >
                  <Trash2 className="size-5" aria-hidden />
                </button>
              )}
              <D.Close
                aria-label={t('common.close')}
                className="grid size-11 place-items-center rounded-full hover:bg-white/15"
              >
                <X className="size-5" aria-hidden />
              </D.Close>
            </div>
          </div>
          <div
            className="relative min-h-0 flex-1"
            onPointerDown={() => setPaused(true)}
            onPointerUp={() => setPaused(false)}
            onPointerCancel={() => setPaused(false)}
          >
            <StoryFace story={story} />
          </div>
          <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-3 pt-10">
            <button
              type="button"
              onClick={prev}
              disabled={g === 0 && i === 0}
              aria-label={t('stories.previous')}
              className="grid size-11 place-items-center rounded-full bg-white/15 disabled:opacity-40"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            {story.link && (
              <a
                href={story.link}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-4 text-meta font-semibold text-black"
              >
                {story.linkLabel ?? t('stories.openLink')} <ExternalLink className="size-4" aria-hidden />
              </a>
            )}
            <button
              type="button"
              onClick={next}
              aria-label={t('stories.next')}
              className="grid size-11 place-items-center rounded-full bg-white/15"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
