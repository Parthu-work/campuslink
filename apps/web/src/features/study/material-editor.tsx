import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Subtitles, Trash2, TriangleAlert } from 'lucide-react';
import {
  MATERIAL_ACCEPT,
  MATERIAL_LANGUAGES,
  MATERIAL_TABS,
  TRANSCRIPT_ACCEPT,
  type MaterialDetailView,
  type MaterialLanguage,
  type MaterialTab,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { ProgressBar } from '../../components/ui/progress';
import { FormError } from '../../components/layout/auth-layout';
import { api, ApiError } from '../../lib/api';
import { uploadWithProgress } from '../../lib/upload';
import { syllabus } from '../../lib/queries';
import { formatDuration, parseChapters } from '../../lib/study';
import { toast } from '../../lib/toast';

/** A file picker that uploads at once, with progress (new version, captions). */
function FileAction({
  label,
  accept,
  path,
  icon,
  onDone,
}: {
  label: string;
  accept: string;
  path: string;
  icon: React.ReactNode;
  onDone: (v: MaterialDetailView) => void;
}) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const send = async (file: File) => {
    const form = new FormData();
    form.set('file', file);
    setError(undefined);
    setProgress(0);
    try {
      onDone(await uploadWithProgress<MaterialDetailView>(path, form, setProgress));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setProgress(null);
    }
  };
  return (
    <div className="grid gap-2">
      <label className="inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-full border border-line-strong px-4 text-meta font-semibold hover:bg-hover">
        {icon} {label}
        <input
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void send(f);
            e.target.value = '';
          }}
        />
      </label>
      {progress !== null && <ProgressBar value={progress} label={label} />}
      <FormError message={error} />
    </div>
  );
}

/**
 * Editing a material (uploader or managers): details and tags, chapters and captions for videos,
 * a new version of the file, and, for owners and admins, a takedown. Deleting asks first.
 */
export function MaterialEditor({
  m,
  subjectId,
  onDone,
}: {
  m: MaterialDetailView;
  subjectId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tree = useQuery(syllabus(subjectId));
  const units = tree.data?.units ?? [];
  const isMedia = m.type === 'video_file' || m.type === 'video_link' || m.type === 'audio';
  const [title, setTitle] = useState(m.title);
  const [description, setDescription] = useState(m.description);
  const [category, setCategory] = useState<MaterialTab>(m.category);
  const [language, setLanguage] = useState<MaterialLanguage>(m.language);
  const [unitId, setUnitId] = useState(m.unitId ?? '');
  const [topicId, setTopicId] = useState(m.topicIds[0] ?? '');
  const [chapters, setChapters] = useState(
    m.chapters.map((c) => `${formatDuration(c.at)} ${c.title}`).join('\n'),
  );
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string>();
  const reasonId = useId();
  const topics = (unitId ? units.filter((u) => u.id === unitId) : units).flatMap((u) => u.topics);
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : t('errors.generic'));
  const refresh = (v: MaterialDetailView) => {
    qc.setQueryData(['material', m.id], v);
    void qc.invalidateQueries({ queryKey: ['materials', subjectId] });
  };
  const save = useMutation({
    mutationFn: () =>
      api.patch<MaterialDetailView>(`/study/materials/${m.id}`, {
        title: title.trim() || m.title,
        description: description.trim(),
        category,
        language,
        unitId: unitId || null,
        topicIds: topicId ? [topicId, ...m.topicIds.filter((x) => x !== topicId)] : m.topicIds,
        ...(isMedia ? { chapters: parseChapters(chapters) } : {}),
      }),
    onSuccess: (v) => {
      refresh(v);
      toast.success(t('common.saved'));
      onDone();
    },
    onError: fail,
  });
  const takedown = useMutation({
    mutationFn: () =>
      api.post<MaterialDetailView>(`/study/materials/${m.id}/takedown`, { reason: reason.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['materials', subjectId] });
      toast.success(t('study.editor2.takenDown'));
      void navigate(`/study/${subjectId}`, { replace: true });
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/study/materials/${m.id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['material', m.id] });
      void qc.invalidateQueries({ queryKey: ['materials', subjectId] });
      toast.success(t('study.editor2.deleted'));
      void navigate(`/study/${subjectId}`, { replace: true });
    },
    onError: fail,
  });

  return (
    <div className="grid gap-5">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label={t('study.form.name')}>
          {({ id }) => (
            <Input id={id} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
          )}
        </Field>
        <Field label={t('study.form.description')} aside={t('common.optional')}>
          {({ id }) => (
            <Textarea id={id} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('study.editor2.category')}>
            {({ id }) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as MaterialTab)}>
                {MATERIAL_TABS.map((c) => (
                  <option key={c} value={c}>
                    {t(`study.tab.${c}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('study.upload.language')}>
            {({ id }) => (
              <Select
                id={id}
                value={language}
                onChange={(e) => setLanguage(e.target.value as MaterialLanguage)}
              >
                {MATERIAL_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`study.language.${l}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('study.filter.unit')}>
            {({ id }) => (
              <Select id={id} value={unitId} onChange={(e) => (setUnitId(e.target.value), setTopicId(''))}>
                <option value="">{t('study.filter.allUnits')}</option>
                {units.map((u, i) => (
                  <option key={u.id} value={u.id}>
                    {t('study.unit', { n: i + 1 })}: {u.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('study.filter.topic')}>
            {({ id }) => (
              <Select id={id} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                <option value="">{t('study.upload.noTopic')}</option>
                {topics.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {isMedia && (
          <Field label={t('study.upload.chapters')} hint={t('study.upload.chaptersHint')}>
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                rows={4}
                value={chapters}
                onChange={(e) => setChapters(e.target.value)}
              />
            )}
          </Field>
        )}
        <FormError message={error} />
        <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </form>

      <section className="grid gap-3 border-t border-line pt-4" aria-labelledby="files-h">
        <h3 id="files-h" className="font-semibold">
          {t('study.editor2.files')}
        </h3>
        {isMedia && (
          <FileAction
            label={t('study.editor2.captions')}
            accept={TRANSCRIPT_ACCEPT}
            path={`/study/materials/${m.id}/transcript`}
            icon={<Subtitles className="size-4" aria-hidden />}
            onDone={(v) => {
              refresh(v);
              toast.success(t('study.editor2.captionsAdded'));
            }}
          />
        )}
        {m.type !== 'video_link' && (
          <FileAction
            label={t('study.editor2.newVersion')}
            accept={MATERIAL_ACCEPT}
            path={`/study/materials/${m.id}/versions`}
            icon={<FileUp className="size-4" aria-hidden />}
            onDone={(v) => {
              refresh(v);
              toast.success(t('study.editor2.versionAdded', { n: v.version }));
            }}
          />
        )}
      </section>

      {m.can.review && (
        <section className="grid gap-2 border-t border-line pt-4" aria-labelledby="takedown-h">
          <h3 id="takedown-h" className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="size-4 text-warning" aria-hidden /> {t('study.editor2.takedown')}
          </h3>
          <p className="text-meta text-fg-2">{t('study.editor2.takedownBody')}</p>
          <label htmlFor={reasonId} className="text-meta font-semibold">
            {t('study.editor2.reason')}
          </label>
          <Input id={reasonId} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          <Button
            variant="outline"
            className="w-fit"
            disabled={reason.trim().length < 5}
            loading={takedown.isPending}
            onClick={() => takedown.mutate()}
          >
            {t('study.editor2.takeDown')}
          </Button>
        </section>
      )}

      <section className="grid gap-2 border-t border-line pt-4">
        {confirm ? (
          <div className="grid gap-2 rounded-[var(--radius-md)] bg-danger-surface p-3" role="alert">
            <p className="text-meta">{t('study.editor2.deleteConfirm')}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
                {t('study.editor2.deleteYes')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" className="w-fit text-danger-ink" onClick={() => setConfirm(true)}>
            <Trash2 className="size-4" aria-hidden /> {t('study.editor2.delete')}
          </Button>
        )}
      </section>
    </div>
  );
}
