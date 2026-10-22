import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog as D } from 'radix-ui';
import { toast } from '../../lib/toast';
import { ChevronLeft, ChevronRight, ExternalLink, Pause, Play, Plus, Trash2, X } from 'lucide-react';
import { STORY_BACKGROUNDS, type StoryView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Field, Input, Textarea } from '../../components/ui/field';
import { Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { api, ApiError } from '../../lib/api';
import { useDialogHistory } from '../../lib/use-dialog-history';
import { useRovingRadio } from '../../lib/use-roving-radio';
import { stories } from '../../lib/queries';
import { useFileUrl } from '../../lib/files';
import { formatRelative } from '../../lib/format';
import { useCan } from '../../lib/me';
import { useTenant } from '../../lib/tenant-context';
import { groupStories, STORY_MS, storyBackground, type StoryGroup } from '../../lib/stories';
import { cn } from '../../lib/cn';

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
          <p className="absolute inset-x-4 bottom-20 rounded-[var(--radius-sm)] bg-[var(--scrim)] p-3 text-center text-lg font-semibold text-white">
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

function StoryViewer({
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
              <p className="min-w-0 flex-1 truncate text-sm">
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
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-black"
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

function StoryComposer({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'text' | 'photo'>('text');
  const [text, setText] = useState('');
  const [background, setBackground] = useState<(typeof STORY_BACKGROUNDS)[number]>('brand');
  const swatch = useRovingRadio({ values: STORY_BACKGROUNDS, value: background, onChange: setBackground });
  const [fileId, setFileId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [alt, setAlt] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const bgId = useId();
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const form = new FormData();
      form.append('for', 'story');
      form.append('file', f);
      return { r: await api.upload<{ id: string }>('/media/images', form), f };
    },
    onSuccess: ({ r, f }) => {
      setFileId(r.id);
      setPreview(URL.createObjectURL(f));
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const create = useMutation({
    mutationFn: () =>
      api.post(
        '/stories',
        mode === 'text'
          ? { kind: 'text', text: text.trim(), background, ...(link.trim() ? { link: link.trim() } : {}) }
          : {
              kind: 'photo',
              fileId,
              alt: alt.trim(),
              text: text.trim(),
              ...(link.trim() ? { link: link.trim() } : {}),
            },
      ),
    onSuccess: () => {
      toast.success(t('stories.posted'));
      void qc.invalidateQueries({ queryKey: ['stories'] });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const ready = mode === 'text' ? !!text.trim() : !!fileId && !!alt.trim();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) create.mutate();
      }}
    >
      <ChoiceGroup
        label={t('stories.kind')}
        variant="chip"
        value={mode}
        options={(['text', 'photo'] as const).map((m) => ({ value: m, label: t(`stories.kinds.${m}`) }))}
        onChange={setMode}
      />
      {mode === 'photo' && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
          />
          {preview ? (
            <img src={preview} alt="" className="max-h-48 justify-self-start rounded-[var(--radius-sm)]" />
          ) : (
            <Button loading={upload.isPending} onClick={() => fileRef.current?.click()}>
              {t('feed.choosePhotos')}
            </Button>
          )}
          <Field label={t('feed.altText', { n: 1 })} hint={t('feed.altHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                maxLength={200}
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
              />
            )}
          </Field>
        </>
      )}
      <Field label={mode === 'text' ? t('stories.text') : t('stories.caption')}>
        {({ id }) => (
          <Textarea
            id={id}
            maxLength={mode === 'text' ? 200 : 120}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[72px]"
          />
        )}
      </Field>
      {mode === 'text' && (
        <fieldset>
          <legend id={bgId} className="mb-1.5 text-meta font-semibold">
            {t('stories.background')}
          </legend>
          <div role="radiogroup" aria-labelledby={bgId} className="flex gap-2">
            {STORY_BACKGROUNDS.map((b, i) => (
              <button
                key={b}
                {...swatch(i)}
                aria-label={t(`stories.bg.${b}`)}
                className="size-11 rounded-full border-2 border-transparent transition-[scale] duration-[var(--dur-fast)] ease-snappy active:scale-90 aria-checked:border-fg"
                style={{ background: storyBackground[b] }}
              />
            ))}
          </div>
        </fieldset>
      )}
      <Field label={t('stories.link')} hint={t('stories.linkHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            type="url"
            placeholder="https://"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
        )}
      </Field>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={!ready} loading={create.isPending}>
          {t('stories.share')}
        </Button>
      </div>
    </form>
  );
}

/** Horizontal row of story rings (24 hours). */
export function StoriesRow() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const canPost = useCan('feed:post');
  const enabled = tenant.features?.stories !== false;
  const q = useQuery({ ...stories(), enabled });
  const [viewing, setViewing] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  if (!enabled) return null;
  const groups = groupStories(q.data ?? []);
  if (!q.isLoading && !groups.length && !canPost) return null;
  return (
    <section aria-label={t('stories.title')}>
      <ul className="-mx-1 flex gap-3 overflow-x-auto px-1 pt-1 pb-2">
        {canPost && (
          <li className="flex-none">
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="grid w-[68px] justify-items-center gap-1 text-xs text-fg-2"
            >
              <span className="grid size-[60px] place-items-center rounded-full border-2 border-dashed border-line-strong text-brand-ink">
                <Plus className="size-6" aria-hidden />
              </span>
              {t('stories.add')}
            </button>
          </li>
        )}
        {q.isLoading &&
          [0, 1, 2].map((k) => (
            <li key={k} className="flex-none">
              <Skeleton className="size-[60px] rounded-full" />
            </li>
          ))}
        {groups.map((gr, idx) => (
          <li key={gr.authorId} className="flex-none">
            <button
              type="button"
              onClick={() => setViewing(idx)}
              className="grid w-[68px] justify-items-center gap-1 text-xs"
              aria-label={t('stories.open', {
                name: gr.mine ? t('stories.yours') : gr.author.name,
                count: gr.stories.length,
              })}
            >
              <span
                className={cn(
                  'grid size-[64px] place-items-center rounded-full p-[3px]',
                  'bg-[conic-gradient(var(--brand),var(--accent),var(--brand-2),var(--brand))]',
                )}
              >
                <span className="grid place-items-center rounded-full bg-bg p-[2px]">
                  <PersonAvatar name={gr.author.name || '?'} fileId={gr.author.avatarFileId} size={54} />
                </span>
              </span>
              <span className="w-full truncate text-center text-fg-2">
                {gr.mine ? t('stories.yours') : gr.author.name.split(' ')[0]}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {viewing !== null && <StoryViewer groups={groups} start={viewing} onClose={() => setViewing(null)} />}
      <Dialog
        open={composing}
        onOpenChange={setComposing}
        title={t('stories.new')}
        description={t('stories.newBody')}
      >
        {composing && <StoryComposer onDone={() => setComposing(false)} />}
      </Dialog>
    </section>
  );
}
