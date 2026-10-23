import { useId, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Check, CircleAlert, Link2, Trash2, Upload } from 'lucide-react';
import {
  MATERIAL_ACCEPT,
  MATERIAL_LANGUAGES,
  MATERIAL_MAX_MB,
  MATERIAL_TABS,
  type MaterialLanguage,
  type MaterialTab,
  type MaterialView,
  type SubjectView,
  type SyllabusUnitView,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { ProgressBar } from '../../components/ui/progress';
import { Segmented } from '../../components/ui/tab-nav';
import { FormError } from '../../components/layout/auth-layout';
import { api, ApiError } from '../../lib/api';
import { uploadWithProgress } from '../../lib/upload';
import { useMaterialProgress } from '../../lib/material-progress';
import { newIdempotencyKey } from '../../lib/format';
import { parseChapters, suggestTopics } from '../../lib/study';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { cn } from '../../lib/cn';

interface Item {
  key: string;
  file: File;
  title: string;
  category: MaterialTab | '';
  unitId: string;
  topicId: string;
  status: 'ready' | 'uploading' | 'sent' | 'error';
  progress: number;
  error: string | null;
  duplicateOf: string | null;
  materialId: string | null;
}

let seq = 0;
const fmtSize = (b: number) =>
  b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

/** One queued file: its tags, then its upload progress and live processing stage. */
function Row({
  item,
  units,
  onChange,
  onRemove,
  subjectId,
}: {
  item: Item;
  units: SyllabusUnitView[];
  onChange: (patch: Partial<Item>) => void;
  onRemove: () => void;
  subjectId: string;
}) {
  const { t } = useTranslation();
  const live = useMaterialProgress((s) => (item.materialId ? s.byId[item.materialId] : undefined));
  const topics = (item.unitId ? units.filter((u) => u.id === item.unitId) : units).flatMap((u) => u.topics);
  const editable = item.status === 'ready' || item.status === 'error';
  return (
    <li className="grid gap-2 rounded-[var(--radius-md)] border border-line p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-meta font-semibold">{item.file.name}</span>
        <span className="text-caption text-fg-3">{fmtSize(item.file.size)}</span>
        {editable && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('study.upload.remove', { name: item.file.name })}
            className="grid size-11 place-items-center rounded-full text-fg-2 hover:bg-hover"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {editable && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            aria-label={t('study.upload.titleFor', { name: item.file.name })}
            value={item.title}
            maxLength={160}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={t('study.upload.titlePlaceholder')}
            className="min-h-11 text-meta"
          />
          <Select
            size="sm"
            aria-label={t('study.upload.categoryFor', { name: item.file.name })}
            value={item.category}
            onChange={(e) => onChange({ category: e.target.value as MaterialTab | '' })}
          >
            <option value="">{t('study.upload.categoryAuto')}</option>
            {MATERIAL_TABS.map((c) => (
              <option key={c} value={c}>
                {t(`study.tab.${c}`)}
              </option>
            ))}
          </Select>
          <Select
            size="sm"
            aria-label={t('study.upload.unitFor', { name: item.file.name })}
            value={item.unitId}
            onChange={(e) => onChange({ unitId: e.target.value, topicId: '' })}
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
            aria-label={t('study.upload.topicFor', { name: item.file.name })}
            value={item.topicId}
            onChange={(e) => onChange({ topicId: e.target.value })}
          >
            <option value="">{t('study.upload.noTopic')}</option>
            {topics.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.title}
              </option>
            ))}
          </Select>
        </div>
      )}
      {item.status === 'uploading' && (
        <ProgressBar value={item.progress} label={t('study.upload.uploading')} />
      )}
      {item.status === 'sent' && (
        <p className="flex items-center gap-2 text-meta" role="status">
          {live?.stage === 'failed' ? (
            <CircleAlert className="size-4 text-danger" aria-hidden />
          ) : (
            <Check className="size-4 text-success" aria-hidden />
          )}
          {live ? t(`study.stage.${live.stage}`) : t('study.upload.sent')}
          {live && live.stage !== 'indexed' && live.stage !== 'failed' && (
            <span className="text-fg-3">{live.progress}%</span>
          )}
        </p>
      )}
      {item.error && (
        <p className="text-meta font-semibold text-danger" role="alert">
          {item.error}{' '}
          {item.duplicateOf && (
            <Link to={`/study/${subjectId}/m/${item.duplicateOf}`} className="text-brand-ink underline">
              {t('study.upload.openExisting')}
            </Link>
          )}
        </p>
      )}
    </li>
  );
}

/**
 * Adding material (spec §10): drop or pick several files (or take a photo), tag each to a unit
 * and topic (suggested from the file name), confirm the right to share, and watch each one upload
 * and move through processing. Video links (YouTube, Vimeo) are added in the second mode.
 */
export function UploadSheet({ subject, units }: { subject: SubjectView; units: SyllabusUnitView[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sheet = useUrlOverlay('add');
  // `files:<topicId>` comes from "Upload material for this" (insights): new files get that topic.
  const [open = '', preset = ''] = (sheet.value ?? '').split(':');
  const mode = open === 'link' ? 'link' : 'files';
  const [items, setItems] = useState<Item[]>([]);
  const [rights, setRights] = useState(false);
  const [language, setLanguage] = useState<MaterialLanguage>('en');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const rightsId = useId();
  const allTopics = units.flatMap((u) => u.topics.map((tp) => ({ ...tp, unitId: u.id })));
  const presetTopic = allTopics.find((tp) => tp.id === preset)?.id;

  const add = (files: FileList | File[]) => {
    const next = [...files].slice(0, 20).map((file): Item => {
      const [topic] = presetTopic ? [presetTopic] : suggestTopics(file.name, allTopics);
      return {
        key: `f${++seq}`,
        file,
        title: '',
        category: '',
        unitId: topic ? (allTopics.find((tp) => tp.id === topic)?.unitId ?? '') : '',
        topicId: topic ?? '',
        status: 'ready',
        progress: 0,
        error: null,
        duplicateOf: null,
        materialId: null,
      };
    });
    setItems((xs) => [...xs, ...next].slice(0, 20));
  };
  const patch = (key: string, p: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const uploadAll = async () => {
    setBusy(true);
    for (const it of items.filter((x) => x.status === 'ready' || x.status === 'error')) {
      if (it.file.size > MATERIAL_MAX_MB.media * 1048576) {
        patch(it.key, { status: 'error', error: t('study.upload.tooBig', { mb: MATERIAL_MAX_MB.media }) });
        continue;
      }
      const form = new FormData();
      form.set('subjectId', subject.id);
      form.set('rights', 'true');
      form.set('language', language);
      if (it.title.trim()) form.set('title', it.title.trim());
      if (it.category) form.set('category', it.category);
      if (it.unitId) form.set('unitId', it.unitId);
      if (it.topicId) form.set('topicIds', it.topicId);
      form.set('file', it.file);
      patch(it.key, { status: 'uploading', progress: 0, error: null, duplicateOf: null });
      try {
        const m = await uploadWithProgress<MaterialView>('/study/materials', form, (p) =>
          patch(it.key, { progress: p }),
        );
        patch(it.key, { status: 'sent', materialId: m.id });
      } catch (e) {
        const dup =
          e instanceof ApiError && e.status === 409
            ? ((e.details as { materialId?: string } | undefined)?.materialId ?? null)
            : null;
        patch(it.key, {
          status: 'error',
          error: e instanceof ApiError ? e.message : t('errors.generic'),
          duplicateOf: dup,
        });
      }
    }
    setBusy(false);
    void qc.invalidateQueries({ queryKey: ['materials', subject.id] });
    void qc.invalidateQueries({ queryKey: ['subject', subject.id] });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) add(e.dataTransfer.files);
  };
  const pending = items.filter((x) => x.status === 'ready' || x.status === 'error').length;

  return (
    <div className="grid gap-4">
      <Segmented<'files' | 'link'>
        label={t('study.upload.mode')}
        value={mode}
        onChange={(v) => sheet.open(v)}
        options={[
          ['files', t('study.upload.files')],
          ['link', t('study.upload.link')],
        ]}
      />
      {mode === 'link' ? (
        <LinkForm subject={subject} units={units} />
      ) : (
        <>
          <label
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={cn(
              'grid cursor-pointer justify-items-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed border-line-strong p-6 text-center transition-colors duration-[var(--dur-fast)] hover:border-brand',
              over && 'border-brand bg-brand-surface',
            )}
          >
            <Upload className="size-7 text-brand-ink" aria-hidden />
            <span className="font-semibold">{t('study.upload.drop')}</span>
            <span className="text-caption text-fg-3">
              {t('study.upload.types', { doc: MATERIAL_MAX_MB.document, media: MATERIAL_MAX_MB.media })}
            </span>
            <input
              type="file"
              multiple
              accept={MATERIAL_ACCEPT}
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) add(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <label className="inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-full border border-line-strong px-4 text-meta font-semibold hover:bg-hover">
            <Camera className="size-4" aria-hidden /> {t('study.upload.camera')}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) add(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          {items.length > 0 && (
            <ul className="grid gap-2" aria-label={t('study.upload.queue')}>
              {items.map((it) => (
                <Row
                  key={it.key}
                  item={it}
                  units={units}
                  subjectId={subject.id}
                  onChange={(p) => patch(it.key, p)}
                  onRemove={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}
                />
              ))}
            </ul>
          )}
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
          <Checkbox id={rightsId} checked={rights} onChange={setRights}>
            {t('study.upload.rights')}
          </Checkbox>
          {!subject.can.manage && <p className="text-caption text-fg-3">{t('study.upload.reviewNote')}</p>}
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            disabled={!rights || pending === 0}
            onClick={() => void uploadAll()}
          >
            {t('study.upload.uploadN', { count: pending })}
          </Button>
        </>
      )}
    </div>
  );
}

/** A YouTube or Vimeo link, its tags and chapters ("1:05 Pumping lemma" per line). */
function LinkForm({ subject, units }: { subject: SubjectView; units: SyllabusUnitView[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [unitId, setUnitId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [chapters, setChapters] = useState('');
  const [rights, setRights] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<MaterialView | null>(null);
  const [key] = useState(newIdempotencyKey);
  const rightsId = useId();
  const topics = (unitId ? units.filter((u) => u.id === unitId) : units).flatMap((u) => u.topics);
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const m = await api.postOnce<MaterialView>(
        '/study/materials/link',
        {
          subjectId: subject.id,
          url: url.trim(),
          title: title.trim(),
          unitId: unitId || null,
          topicIds: topicId ? [topicId] : [],
          chapters: parseChapters(chapters),
          rights: true,
        },
        key,
      );
      setDone(m);
      void qc.invalidateQueries({ queryKey: ['materials', subject.id] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };
  if (done)
    return (
      <p
        className="flex items-center gap-2 rounded-[var(--radius-md)] bg-success-surface p-3 text-meta"
        role="status"
      >
        <Check className="size-4 text-success" aria-hidden />{' '}
        {t('study.upload.linkAdded', { title: done.title })}
      </p>
    );
  return (
    <div className="grid gap-4">
      <Field label={t('study.upload.url')} hint={t('study.upload.urlHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            type="url"
            inputMode="url"
            placeholder="https://youtu.be/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('study.upload.titleOptional')}>
        {({ id }) => (
          <Input id={id} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
        )}
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
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
          <option value="">{t('study.upload.noTopic')}</option>
          {topics.map((tp) => (
            <option key={tp.id} value={tp.id}>
              {tp.title}
            </option>
          ))}
        </Select>
      </div>
      <Field label={t('study.upload.chapters')} hint={t('study.upload.chaptersHint')}>
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            rows={4}
            value={chapters}
            onChange={(e) => setChapters(e.target.value)}
            placeholder={'0:00 Intro\n1:05 Pumping lemma'}
          />
        )}
      </Field>
      <Checkbox id={rightsId} checked={rights} onChange={setRights}>
        {t('study.upload.rightsLink')}
      </Checkbox>
      <FormError message={error} />
      <Button
        variant="primary"
        size="lg"
        loading={busy}
        disabled={!rights || !url.trim()}
        onClick={() => void submit()}
      >
        <Link2 className="size-5" aria-hidden /> {t('study.upload.addLink')}
      </Button>
    </div>
  );
}
