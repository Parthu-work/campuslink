import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { BRANCHES, SEMESTER_MAX, subjectBody, type Branch, type SubjectView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { Chip } from '../../components/ui/misc';
import { FormError } from '../../components/layout/auth-layout';
import { api } from '../../lib/api';
import { applyApiError } from '../../lib/errors';
import { newIdempotencyKey } from '../../lib/format';
import { toast } from '../../lib/toast';
import { parseBatches } from '../../lib/study';

const formSchema = subjectBody
  .omit({ ownerIds: true, batches: true, branches: true, semester: true })
  .extend({ batches: z.string().max(80), semester: z.string() });
type Form = z.input<typeof formSchema>;

/**
 * Create or edit a subject: name, code, semester, regulation, who takes it (branches and batches;
 * none means everyone) and a short description. Loads in its own chunk (the form library and Zod).
 */
export function SubjectForm({
  subject,
  onDone,
}: {
  subject?: SubjectView;
  /** Called with the new subject after a create (the page then opens it), or with nothing. */
  onDone: (created?: SubjectView) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [branches, setBranches] = useState<Branch[]>(subject?.branches ?? []);
  const [key] = useState(newIdempotencyKey);
  const form = useForm<Form>({
    mode: 'onTouched',
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: subject?.name ?? '',
      code: subject?.code ?? '',
      regulation: subject?.regulation ?? '',
      description: subject?.description ?? '',
      batches: subject?.batches.join(', ') ?? '',
      semester: subject?.semester ? String(subject.semester) : '',
    },
  });
  const save = useMutation({
    mutationFn: (v: Form) => {
      const body = {
        name: v.name,
        code: v.code,
        regulation: v.regulation ?? '',
        description: v.description ?? '',
        branches,
        batches: parseBatches(v.batches),
        semester: v.semester ? Number(v.semester) : null,
      };
      return subject
        ? api.patch<SubjectView>(`/study/subjects/${subject.id}`, body)
        : api.postOnce<SubjectView>('/study/subjects', body, key);
    },
    onSuccess: (s) => {
      qc.setQueryData(['subject', s.id], s);
      void qc.invalidateQueries({ queryKey: ['subjects'] });
      toast.success(subject ? t('common.saved') : t('study.created'));
      onDone(subject ? undefined : s);
    },
    onError: (e) => applyApiError(e, form.setError, t('errors.generic')),
  });
  const err = form.formState.errors;
  const toggle = (b: Branch) =>
    setBranches((xs) => (xs.includes(b) ? xs.filter((x) => x !== b) : [...xs, b]));

  return (
    <form className="grid gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
      <Field label={t('study.form.name')} error={err.name?.message}>
        {({ id, describedBy, invalid }) => (
          <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...form.register('name')} />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('study.form.code')} hint={t('study.form.codeHint')} error={err.code?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              className="font-mono uppercase"
              autoCapitalize="characters"
              {...form.register('code')}
            />
          )}
        </Field>
        <Field label={t('study.form.semester')}>
          {({ id }) => (
            <Select id={id} {...form.register('semester')}>
              <option value="">{t('study.form.noSemester')}</option>
              {Array.from({ length: SEMESTER_MAX }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  {t('study.semester', { n: i + 1 })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t('study.form.regulation')}
          aside={t('common.optional')}
          error={err.regulation?.message}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              placeholder="R20"
              {...form.register('regulation')}
            />
          )}
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-meta font-semibold">{t('study.form.branches')}</legend>
        <p className="-mt-1 text-caption text-fg-3">{t('study.form.branchesHint')}</p>
        <div className="flex flex-wrap gap-2">
          {BRANCHES.map((b) => (
            <Chip key={b} pressed={branches.includes(b)} onClick={() => toggle(b)}>
              {b}
            </Chip>
          ))}
        </div>
      </fieldset>
      <Field label={t('study.form.batches')} hint={t('study.form.batchesHint')} error={err.batches?.message}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            inputMode="numeric"
            placeholder="2026, 2027"
            {...form.register('batches')}
          />
        )}
      </Field>
      <Field
        label={t('study.form.description')}
        aside={t('common.optional')}
        error={err.description?.message}
      >
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            rows={3}
            {...form.register('description')}
          />
        )}
      </Field>
      <FormError message={err.root?.message} />
      <div className="grid gap-2 sm:flex sm:flex-row-reverse">
        <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
          {subject ? t('common.save') : t('study.create')}
        </Button>
        <Button variant="ghost" size="lg" onClick={() => onDone()}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
