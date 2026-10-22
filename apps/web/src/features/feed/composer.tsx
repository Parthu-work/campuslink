import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { Film, ImagePlus, Link2, ListChecks, PenLine, X } from 'lucide-react';
import {
  POST_MAX,
  REEL_MAX_SECONDS,
  TOPICS,
  POST_KINDS,
  type PostKind,
  type PostView,
  type Topic,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { Chip } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { useCan, useMe } from '../../lib/me';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { newIdempotencyKey } from '../../lib/format';
import { PersonAvatar } from '../../components/ui/person-avatar';

type Media = { fileId: string; alt: string; preview: string; durationSec?: number };
const KINDS: readonly [PostKind, typeof PenLine][] = [
  ['text', PenLine],
  ['photo', ImagePlus],
  ['reel', Film],
  ['poll', ListChecks],
  ['link', Link2],
];

export function TopicPicker({
  value,
  onChange,
  max = 3,
}: {
  value: Topic[];
  onChange: (t: Topic[]) => void;
  max?: number;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-[13px] font-semibold">{t('feed.topicsPick', { max })}</legend>
      <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
        {TOPICS.map((tp) => {
          const on = value.includes(tp);
          return (
            <Chip
              key={tp}
              pressed={on}
              disabled={!on && value.length >= max}
              onClick={() => onChange(on ? value.filter((x) => x !== tp) : [...value, tp])}
            >
              {t(`topics.${tp}`)}
            </Chip>
          );
        })}
      </div>
    </fieldset>
  );
}

function ComposerForm({ initialKind, onDone }: { initialKind: PostKind; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canAnnounce = useCan('announcements:post');
  const [kind, setKind] = useState<PostKind>(initialKind);
  const [body, setBody] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [announcement, setAnnouncement] = useState(false);
  const [media, setMedia] = useState<Media[]>([]);
  const [options, setOptions] = useState(['', '']);
  const [days, setDays] = useState(3);
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(newIdempotencyKey());
  const fileInput = useRef<HTMLInputElement>(null);
  const counterId = useId();
  const announceId = useId();

  // Object URLs for local previews are released when the composer closes.
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError('');
    try {
      for (const f of [...files].slice(0, kind === 'reel' ? 1 : 4 - media.length)) {
        const form = new FormData();
        if (kind === 'photo') form.append('for', 'post');
        form.append('file', f);
        const r = await api.upload<{ id: string; durationSec?: number }>(
          kind === 'reel' ? '/media/videos' : '/media/images',
          form,
        );
        const m: Media = { fileId: r.id, alt: '', preview: URL.createObjectURL(f) };
        previews.current.push(m.preview);
        if (r.durationSec !== undefined) m.durationSec = r.durationSec;
        setMedia((cur) => (kind === 'reel' ? [m] : [...cur, m]));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const payload = () => {
    const common = { topics, announcement };
    switch (kind) {
      case 'text':
        return { kind, body, ...common };
      case 'photo':
      case 'reel':
        return { kind, body, media: media.map((m) => ({ fileId: m.fileId, alt: m.alt.trim() })), ...common };
      case 'poll':
        return {
          kind,
          body,
          poll: { options: options.map((o) => o.trim()).filter(Boolean), closesInDays: days },
          ...common,
        };
      case 'link':
        return { kind, body, url: url.trim(), ...common };
    }
  };
  const ready =
    (kind === 'text' && body.trim().length > 0) ||
    ((kind === 'photo' || kind === 'reel') && media.length > 0 && media.every((m) => m.alt.trim())) ||
    (kind === 'poll' && body.trim().length >= 3 && options.filter((o) => o.trim()).length >= 2) ||
    (kind === 'link' && /^https:\/\/.+/.test(url.trim()));

  const publish = useMutation({
    mutationFn: () => api.postOnce<PostView>('/posts', payload(), key.current),
    onSuccess: () => {
      toast.success(t('feed.published'));
      void qc.invalidateQueries({ queryKey: ['feed'] });
      void qc.invalidateQueries({ queryKey: ['posts'] });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) publish.mutate();
      }}
    >
      <div role="radiogroup" aria-label={t('feed.kind')} className="flex flex-wrap gap-1.5">
        {KINDS.map(([k, Icon]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => {
              setKind(k);
              setMedia([]);
              setError('');
            }}
            className="inline-flex min-h-10 flex-none items-center gap-1.5 rounded-full border border-line-strong px-3 text-sm font-medium text-fg-2 aria-checked:border-brand aria-checked:bg-[color-mix(in_srgb,var(--brand)_16%,transparent)] aria-checked:text-fg"
          >
            <Icon className="size-4" aria-hidden /> {t(`feed.kinds.${k}`)}
          </button>
        ))}
      </div>
      <Field label={kind === 'poll' ? t('feed.pollQuestion') : t('feed.body')} hint={t('feed.formatHint')}>
        {({ id, describedBy }) => (
          <>
            <Textarea
              id={id}
              aria-describedby={[describedBy, counterId].filter(Boolean).join(' ')}
              value={body}
              maxLength={kind === 'poll' ? 300 : kind === 'reel' ? 600 : POST_MAX}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t(`feed.placeholder.${kind}`)}
              className="min-h-[120px]"
            />
            <p id={counterId} className="justify-self-end font-mono text-[11px] text-fg-3" aria-live="polite">
              {body.length}/{kind === 'poll' ? 300 : kind === 'reel' ? 600 : POST_MAX}
            </p>
          </>
        )}
      </Field>

      {(kind === 'photo' || kind === 'reel') && (
        <div className="grid gap-3">
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            accept={kind === 'reel' ? 'video/mp4,video/quicktime' : 'image/jpeg,image/png,image/webp'}
            multiple={kind === 'photo'}
            onChange={(e) => void upload(e.target.files)}
          />
          {(kind === 'reel' ? media.length === 0 : media.length < 4) && (
            <Button loading={uploading} onClick={() => fileInput.current?.click()}>
              {kind === 'reel' ? (
                <Film className="size-4" aria-hidden />
              ) : (
                <ImagePlus className="size-4" aria-hidden />
              )}
              {kind === 'reel'
                ? t('feed.chooseVideo', { seconds: REEL_MAX_SECONDS })
                : t('feed.choosePhotos')}
            </Button>
          )}
          {media.map((m, i) => (
            <div key={m.fileId} className="grid grid-cols-[72px_1fr_auto] items-start gap-3">
              {kind === 'reel' ? (
                <video
                  src={m.preview}
                  muted
                  className="size-[72px] rounded-[var(--radius-sm)] object-cover"
                />
              ) : (
                <img src={m.preview} alt="" className="size-[72px] rounded-[var(--radius-sm)] object-cover" />
              )}
              <Field
                label={kind === 'reel' ? t('feed.videoDescription') : t('feed.altText', { n: i + 1 })}
                hint={
                  kind === 'reel'
                    ? t('feed.videoDescriptionHint', { seconds: m.durationSec ?? '' })
                    : t('feed.altHint')
                }
              >
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    required
                    maxLength={kind === 'reel' ? 300 : 200}
                    value={m.alt}
                    onChange={(e) =>
                      setMedia((cur) =>
                        cur.map((x) => (x.fileId === m.fileId ? { ...x, alt: e.target.value } : x)),
                      )
                    }
                  />
                )}
              </Field>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('feed.removeMedia')}
                onClick={() => setMedia((cur) => cur.filter((x) => x.fileId !== m.fileId))}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      )}

      {kind === 'poll' && (
        <div className="grid gap-3">
          {options.map((o, i) => (
            <Field key={i} label={t('feed.option', { n: i + 1 })}>
              {({ id }) => (
                <Input
                  id={id}
                  value={o}
                  maxLength={80}
                  onChange={(e) => setOptions((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
                />
              )}
            </Field>
          ))}
          <div className="flex flex-wrap items-end gap-3">
            {options.length < 4 && (
              <Button size="sm" onClick={() => setOptions((cur) => [...cur, ''])}>
                {t('feed.addOption')}
              </Button>
            )}
            <label className="ml-auto grid gap-1.5 text-[13px] font-semibold">
              {t('feed.pollLength')}
              <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="min-h-10">
                {[1, 3, 7, 14].map((d) => (
                  <option key={d} value={d}>
                    {t('feed.days', { count: d })}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </div>
      )}

      {kind === 'link' && (
        <Field label={t('feed.linkUrl')} hint={t('feed.linkHint')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="url"
              inputMode="url"
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}
        </Field>
      )}

      <TopicPicker value={topics} onChange={setTopics} />
      {canAnnounce && (
        <Checkbox id={announceId} checked={announcement} onChange={setAnnouncement}>
          {t('feed.markAnnouncement')}
        </Checkbox>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={!ready || uploading} loading={publish.isPending}>
          {t('feed.publish')}
        </Button>
      </div>
    </form>
  );
}

const COMPOSE_KINDS: readonly PostKind[] = POST_KINDS;

/** "Share something useful" entry point; the form remounts per open (fresh idempotency key). */
export function Composer() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  // The composer's open state lives in the URL (?compose=text), so Back closes it and the Create
  // sheet can open it from anywhere.
  const overlay = useUrlOverlay('compose');
  const open = COMPOSE_KINDS.find((k) => k === overlay.value) ?? null;
  const setOpen = (kind: PostKind | null) => (kind ? overlay.open(kind) : overlay.close());
  return (
    <>
      <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-line bg-surface-1 p-3">
        <PersonAvatar name={me?.name ?? '?'} fileId={null} size={36} />
        <button
          type="button"
          onClick={() => setOpen('text')}
          className="min-h-11 min-w-0 flex-1 rounded-full border border-line-strong px-4 text-left text-sm text-fg-3 hover:border-brand"
        >
          {t('feed.composerPrompt')}
        </button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('feed.kinds.photo')}
          onClick={() => setOpen('photo')}
        >
          <ImagePlus className="size-5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('feed.kinds.reel')}
          onClick={() => setOpen('reel')}
          className="hidden sm:inline-flex"
        >
          <Film className="size-5" aria-hidden />
        </Button>
      </div>
      <Dialog
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={t('feed.newPost')}
        history={false}
      >
        {open && <ComposerForm initialKind={open} onDone={() => setOpen(null)} />}
      </Dialog>
    </>
  );
}
