import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ClipboardPaste, Plus, Trash2 } from 'lucide-react';
import {
  SYLLABUS_MAX_TOPICS,
  SYLLABUS_MAX_UNITS,
  type SyllabusInput,
  type SyllabusView,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Field, Input, Textarea } from '../../components/ui/field';
import { Card } from '../../components/ui/misc';
import { FormError } from '../../components/layout/auth-layout';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';
import { draftKey, fromDraft, move, toDraft, type DraftTopic, type DraftUnit } from '../../lib/study';

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-11 flex-none place-items-center rounded-full text-fg-2 hover:bg-hover hover:text-fg disabled:opacity-40 [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

/**
 * Editing a subject's syllabus: paste it and get a suggested Unit → Topic tree to review (nothing
 * is invented: every title comes from the pasted text), or build it by hand. Units and topics keep
 * their ids, so material tagged to a topic stays tagged after a rename or re-order.
 */
export function SyllabusEditor({
  subjectId,
  initial,
  onDone,
}: {
  subjectId: string;
  initial: SyllabusView;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [units, setUnits] = useState<DraftUnit[]>(() => toDraft(initial));
  const [paste, setPaste] = useState(initial.units.length === 0);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();

  const parse = useMutation({
    mutationFn: () => api.post<SyllabusInput>('/study/syllabus/parse', { text }),
    onSuccess: (tree) => {
      if (!tree.units.length) return setError(t('study.editor.nothingFound'));
      setUnits(toDraft(tree));
      setPaste(false);
      setError(undefined);
      toast.success(t('study.editor.suggested', { count: tree.units.length }));
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const save = useMutation({
    mutationFn: () => api.put<SyllabusView>(`/study/subjects/${subjectId}/syllabus`, fromDraft(units)),
    onSuccess: (tree) => {
      qc.setQueryData(['syllabus', subjectId], tree);
      void qc.invalidateQueries({ queryKey: ['subject', subjectId] });
      void qc.invalidateQueries({ queryKey: ['subjects'] });
      toast.success(t('common.saved'));
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });

  const setUnit = (i: number, patch: Partial<DraftUnit>) =>
    setUnits((us) => us.map((u, j) => (j === i ? { ...u, ...patch } : u)));
  const setTopic = (i: number, k: number, patch: Partial<DraftTopic>) =>
    setUnit(i, { topics: (units[i]?.topics ?? []).map((tp, j) => (j === k ? { ...tp, ...patch } : tp)) });

  if (paste)
    return (
      <div className="grid gap-4">
        <Field label={t('study.editor.pasteLabel')} hint={t('study.editor.pasteHint')} error={error}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('study.editor.pastePlaceholder')}
            />
          )}
        </Field>
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            size="lg"
            loading={parse.isPending}
            disabled={!text.trim()}
            onClick={() => parse.mutate()}
          >
            <ClipboardPaste className="size-5" aria-hidden /> {t('study.editor.suggest')}
          </Button>
          <Button variant="ghost" size="lg" onClick={() => setPaste(false)}>
            {t('study.editor.byHand')}
          </Button>
        </div>
      </div>
    );

  return (
    <div className="grid gap-4">
      <p className="text-meta text-fg-2">{t('study.editor.intro')}</p>
      <Button variant="outline" size="sm" className="w-fit" onClick={() => setPaste(true)}>
        <ClipboardPaste className="size-4" aria-hidden /> {t('study.editor.pasteAgain')}
      </Button>
      <ol className="grid gap-3">
        {units.map((u, i) => (
          <li key={u.key}>
            <Card className="grid gap-3 p-3">
              <div className="flex items-end gap-1">
                <div className="min-w-0 flex-1">
                  <Field label={t('study.unit', { n: i + 1 })}>
                    {({ id }) => (
                      <Input
                        id={id}
                        value={u.title}
                        maxLength={160}
                        onChange={(e) => setUnit(i, { title: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
                <IconButton
                  label={t('study.editor.up', { what: u.title || t('study.unit', { n: i + 1 }) })}
                  disabled={i === 0}
                  onClick={() => setUnits((us) => move(us, i, -1))}
                >
                  <ArrowUp />
                </IconButton>
                <IconButton
                  label={t('study.editor.down', { what: u.title || t('study.unit', { n: i + 1 }) })}
                  disabled={i === units.length - 1}
                  onClick={() => setUnits((us) => move(us, i, 1))}
                >
                  <ArrowDown />
                </IconButton>
                <IconButton
                  label={t('study.editor.remove', { what: u.title || t('study.unit', { n: i + 1 }) })}
                  onClick={() => setUnits((us) => us.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </IconButton>
              </div>
              <ul className="grid gap-2 border-l-2 border-line pl-3">
                {u.topics.map((tp, k) => {
                  const name = tp.title || t('study.editor.topicN', { n: k + 1 });
                  return (
                    <li key={tp.key} className="grid gap-1">
                      <div className="flex items-center gap-1">
                        <Input
                          aria-label={t('study.editor.topicLabel', { n: k + 1, unit: i + 1 })}
                          value={tp.title}
                          maxLength={160}
                          onChange={(e) => setTopic(i, k, { title: e.target.value })}
                          className="min-w-0 flex-1"
                        />
                        <IconButton
                          label={t('study.editor.up', { what: name })}
                          disabled={k === 0}
                          onClick={() => setUnit(i, { topics: move(u.topics, k, -1) })}
                        >
                          <ArrowUp />
                        </IconButton>
                        <IconButton
                          label={t('study.editor.down', { what: name })}
                          disabled={k === u.topics.length - 1}
                          onClick={() => setUnit(i, { topics: move(u.topics, k, 1) })}
                        >
                          <ArrowDown />
                        </IconButton>
                        <IconButton
                          label={t('study.editor.remove', { what: name })}
                          onClick={() => setUnit(i, { topics: u.topics.filter((_, j) => j !== k) })}
                        >
                          <Trash2 />
                        </IconButton>
                      </div>
                      <Input
                        aria-label={t('study.editor.keywordsLabel', { what: name })}
                        placeholder={t('study.editor.keywords')}
                        value={tp.keywords.join(', ')}
                        onChange={(e) =>
                          setTopic(i, k, {
                            keywords: e.target.value
                              .split(',')
                              .map((w) => w.trimStart().slice(0, 40))
                              .slice(0, 12),
                          })
                        }
                        onBlur={() =>
                          setTopic(i, k, { keywords: tp.keywords.map((w) => w.trim()).filter(Boolean) })
                        }
                        className="min-h-11 text-meta"
                      />
                    </li>
                  );
                })}
                <li>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={u.topics.length >= SYLLABUS_MAX_TOPICS}
                    onClick={() =>
                      setUnit(i, { topics: [...u.topics, { key: draftKey(), title: '', keywords: [] }] })
                    }
                  >
                    <Plus className="size-4" aria-hidden /> {t('study.editor.addTopic')}
                  </Button>
                </li>
              </ul>
            </Card>
          </li>
        ))}
      </ol>
      <Button
        variant="outline"
        disabled={units.length >= SYLLABUS_MAX_UNITS}
        onClick={() => setUnits((us) => [...us, { key: draftKey(), title: '', topics: [] }])}
      >
        <Plus className="size-5" aria-hidden /> {t('study.editor.addUnit')}
      </Button>
      <FormError message={error} />
      <div className="grid gap-2 sm:flex sm:flex-row-reverse">
        <Button variant="primary" size="lg" loading={save.isPending} onClick={() => save.mutate()}>
          {t('study.editor.save')}
        </Button>
        <Button variant="ghost" size="lg" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
