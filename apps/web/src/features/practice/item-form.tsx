import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  CODE_LANGUAGES,
  PRACTICE_AREAS,
  PRACTICE_CODE_MAX,
  PRACTICE_DIFFICULTIES,
  PRACTICE_KINDS,
  PRACTICE_OPTIONS_MAX,
  PRACTICE_TESTS_MAX,
  PRACTICE_TOPIC_AREAS,
  itemProblem,
  type CodeLanguage,
  type PracticeDifficulty,
  type PracticeItemView,
  type PracticeKind,
  type PracticeTopic,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { TagInput } from '../../components/ui/tag-input';
import { api, ApiError } from '../../lib/api';
import { useCan } from '../../lib/me';
import { toast } from '../../lib/toast';

/**
 * Write a practice question, or (reviewers) correct one and tag its companies (prompt 2, G4).
 * The same rules as the API (`itemProblem`) run here first, with the problem in the member's language.
 */
export function ItemForm({
  item,
  onClose,
  prefill,
  onSaved,
}: {
  item?: PracticeItemView;
  onClose: () => void;
  /** Prompt 2, G10: a question from an interview write-up, to be written up as a practice item. */
  prefill?: { text: string; companies: string[] };
  onSaved?: (saved: PracticeItemView) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const reviewer = useCan('practice:review');
  const [kind, setKind] = useState<PracticeKind>(item?.kind ?? 'mcq');
  const [topic, setTopic] = useState<PracticeTopic>(item?.topic ?? 'percentages');
  const [difficulty, setDifficulty] = useState<PracticeDifficulty>(item?.difficulty ?? 'medium');
  const [companies, setCompanies] = useState<string[]>(item?.companies ?? prefill?.companies ?? []);
  const [text, setText] = useState(item?.text ?? prefill?.text ?? '');
  const [code, setCode] = useState(item?.code ?? '');
  const [codeLanguage, setCodeLanguage] = useState<CodeLanguage | ''>(item?.codeLanguage ?? '');
  const [options, setOptions] = useState<string[]>(item?.options.length ? item.options : ['', '', '', '']);
  const [answer, setAnswer] = useState(item?.answer ?? (kind === 'mcq' ? '0' : ''));
  const [tolerance, setTolerance] = useState(item?.tolerance != null ? String(item.tolerance) : '');
  const [explanation, setExplanation] = useState(item?.explanation ?? '');
  const [tests, setTests] = useState(item?.tests.length ? item.tests : [{ stdin: '', expected: '' }]);
  const [error, setError] = useState('');

  const filledOptions = options.map((o) => o.trim());
  const body = {
    kind,
    topic,
    difficulty,
    companies,
    text: text.trim(),
    code: kind === 'mcq' || kind === 'output_prediction' ? code : '',
    codeLanguage: codeLanguage || null,
    options: kind === 'mcq' ? filledOptions.filter(Boolean) : [],
    answer: kind === 'coding' ? '' : kind === 'mcq' ? answer : answer.trim(),
    tolerance: kind === 'numeric' && tolerance.trim() ? Number(tolerance) : null,
    explanation: explanation.trim(),
    tests: kind === 'coding' ? tests.filter((x) => x.expected.trim()) : [],
  };
  // The right option's index counts only filled options, so map it after dropping blanks.
  if (kind === 'mcq') {
    const right = filledOptions[Number(answer)] ?? '';
    body.answer = right ? String(body.options.indexOf(right)) : '';
  }
  const problem = itemProblem(body);
  const tooShort = body.text.length < 10 || body.explanation.length < 10;

  const save = useMutation({
    mutationFn: () =>
      item
        ? api.put<PracticeItemView>(`/admin/practice/items/${item.id}`, body)
        : api.post<PracticeItemView>('/practice/items', body),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['practice-items'] });
      void qc.invalidateQueries({ queryKey: ['practice'], exact: true });
      toast.success(
        item
          ? t('practice.form.saved')
          : saved.status === 'pending'
            ? t('practice.form.sentForReview')
            : t('practice.form.added'),
      );
      onSaved?.(saved);
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={item ? t('practice.form.editTitle') : t('practice.form.addTitle')}
      description={reviewer ? t('practice.form.bodyReviewer') : t('practice.form.bodyAlumni')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            type="submit"
            form="practice-item"
            loading={save.isPending}
            disabled={!!problem || tooShort}
          >
            {item ? t('practice.form.save') : reviewer ? t('practice.form.add') : t('practice.form.send')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <form
        id="practice-item"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem && !tooShort) save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('practice.form.kind')}>
            {({ id }) => (
              <Select
                id={id}
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as PracticeKind;
                  setKind(k);
                  setAnswer(k === 'mcq' ? '0' : '');
                }}
              >
                {PRACTICE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`practice.kind.${k}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('practice.form.topic')}>
            {({ id }) => (
              <Select id={id} value={topic} onChange={(e) => setTopic(e.target.value as PracticeTopic)}>
                {PRACTICE_AREAS.map((a) => (
                  <optgroup key={a} label={t(`practice.area.${a}`)}>
                    {PRACTICE_TOPIC_AREAS[a].map((x) => (
                      <option key={x} value={x}>
                        {t(`practice.topic.${x}`)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('practice.form.difficulty')}>
            {({ id }) => (
              <Select
                id={id}
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as PracticeDifficulty)}
              >
                {PRACTICE_DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {t(`practice.difficulty.${d}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label={t('practice.form.question')} hint={t('practice.form.questionHint')}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
        {kind !== 'numeric' && (
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            {kind !== 'coding' ? (
              <Field label={t('practice.form.code')} hint={t('practice.form.codeHint')}>
                {({ id, describedBy }) => (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    rows={kind === 'output_prediction' ? 8 : 4}
                    spellCheck={false}
                    className="font-mono"
                    maxLength={PRACTICE_CODE_MAX}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                )}
              </Field>
            ) : (
              <p className="self-end text-meta text-fg-2">{t('practice.form.codingNote')}</p>
            )}
            <Field label={t('practice.form.language')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={codeLanguage}
                  onChange={(e) => setCodeLanguage(e.target.value as CodeLanguage | '')}
                >
                  <option value="">{t('practice.form.noLanguage')}</option>
                  {CODE_LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {t(`practice.language.${l}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}
        {kind === 'mcq' && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-meta font-semibold">{t('practice.form.options')}</legend>
            <p className="text-caption text-fg-3">{t('practice.form.optionsHint')}</p>
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <label className="flex min-h-11 min-w-11 items-center justify-center">
                  <input
                    type="radio"
                    name="right-option"
                    className="size-5 accent-[var(--brand)]"
                    checked={answer === String(i)}
                    onChange={() => setAnswer(String(i))}
                    aria-label={t('practice.form.rightOption', { n: i + 1 })}
                  />
                </label>
                <Input
                  aria-label={t('practice.form.option', { n: i + 1 })}
                  maxLength={300}
                  value={o}
                  onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
                />
                {options.length > 2 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('practice.form.removeOption', { n: i + 1 })}
                    onClick={() => {
                      setOptions(options.filter((_, j) => j !== i));
                      if (Number(answer) >= i && Number(answer) > 0) setAnswer(String(Number(answer) - 1));
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </div>
            ))}
            {options.length < PRACTICE_OPTIONS_MAX && (
              <div>
                <Button variant="ghost" onClick={() => setOptions([...options, ''])}>
                  <Plus className="size-4" aria-hidden /> {t('practice.form.addOption')}
                </Button>
              </div>
            )}
          </fieldset>
        )}
        {kind === 'numeric' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('practice.form.answerNumber')}>
              {({ id }) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  maxLength={40}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('practice.form.tolerance')} hint={t('practice.form.toleranceHint')}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="decimal"
                  maxLength={20}
                  value={tolerance}
                  onChange={(e) => setTolerance(e.target.value)}
                />
              )}
            </Field>
          </div>
        )}
        {kind === 'output_prediction' && (
          <Field label={t('practice.form.answerOutput')}>
            {({ id }) => (
              <Textarea
                id={id}
                rows={3}
                spellCheck={false}
                className="font-mono"
                maxLength={2000}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              />
            )}
          </Field>
        )}
        {kind === 'coding' && (
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-meta font-semibold">{t('practice.form.tests')}</legend>
            <p className="text-caption text-fg-3">{t('practice.form.testsHint')}</p>
            {tests.map((x, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field label={t('practice.form.input', { n: i + 1 })}>
                  {({ id }) => (
                    <Textarea
                      id={id}
                      rows={2}
                      className="font-mono"
                      maxLength={2000}
                      value={x.stdin}
                      onChange={(e) =>
                        setTests(tests.map((y, j) => (j === i ? { ...y, stdin: e.target.value } : y)))
                      }
                    />
                  )}
                </Field>
                <Field label={t('practice.form.expected', { n: i + 1 })}>
                  {({ id }) => (
                    <Textarea
                      id={id}
                      rows={2}
                      className="font-mono"
                      maxLength={2000}
                      value={x.expected}
                      onChange={(e) =>
                        setTests(tests.map((y, j) => (j === i ? { ...y, expected: e.target.value } : y)))
                      }
                    />
                  )}
                </Field>
                {tests.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('practice.form.removeTest', { n: i + 1 })}
                    onClick={() => setTests(tests.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </div>
            ))}
            {tests.length < PRACTICE_TESTS_MAX && (
              <div>
                <Button variant="ghost" onClick={() => setTests([...tests, { stdin: '', expected: '' }])}>
                  <Plus className="size-4" aria-hidden /> {t('practice.form.addTest')}
                </Button>
              </div>
            )}
          </fieldset>
        )}
        <Field label={t('practice.form.explanation')} hint={t('practice.form.explanationHint')}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              maxLength={2000}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
            />
          )}
        </Field>
        <TagInput
          label={t('practice.form.companies')}
          hint={t('practice.form.companiesHint')}
          value={companies}
          onChange={setCompanies}
          max={10}
        />
        {problem && (text || explanation) && (
          <p className="text-meta text-warning-ink">{t(`practice.form.problem.${problem.path}`)}</p>
        )}
        {error && (
          <p role="alert" className="text-meta font-medium text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
