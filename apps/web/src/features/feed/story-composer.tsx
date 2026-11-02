/* The new-story form, loaded when "Your story" is tapped. */
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { STORY_BACKGROUNDS } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Field, Input, Textarea } from '../../components/ui/field';
import { api, ApiError } from '../../lib/api';
import { useRovingRadio } from '../../lib/use-roving-radio';
import { storyBackground } from '../../lib/stories';

export function StoryComposer({ onDone }: { onDone: () => void }) {
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
        <p role="alert" className="text-meta font-medium text-danger">
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
