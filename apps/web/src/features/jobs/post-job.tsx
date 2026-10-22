import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { BRANCHES, JOB_LEVELS, JOB_MODES, JOB_TYPES, jobBody, type JobView } from '@campuslink/shared';
import type { z } from 'zod';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { Card, Chip } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { TagInput } from '../../components/ui/tag-input';
import { api } from '../../lib/api';
import { applyApiError } from '../../lib/errors';
import { newIdempotencyKey } from '../../lib/format';

type Form = z.input<typeof jobBody>;

export function PostJobPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [key] = useState(newIdempotencyKey);
  const [withSalary, setWithSalary] = useState(false);
  const form = useForm<Form>({
    resolver: zodResolver(jobBody),
    defaultValues: {
      mode: 'hybrid',
      type: 'full_time',
      level: 'fresher',
      skills: [],
      branches: [],
      freshersOk: true,
      expiresInDays: 30,
    },
  });
  const { register, handleSubmit, formState, control, setValue, setError } = form;
  const e = formState.errors;
  const branches = useWatch({ control, name: 'branches' }) ?? [];
  const skills = useWatch({ control, name: 'skills' }) ?? [];
  const freshersOk = useWatch({ control, name: 'freshersOk' });
  const post = useMutation({
    mutationFn: (body: Form) =>
      api.postOnce<JobView>('/jobs', withSalary ? body : { ...body, salary: undefined }, key),
    onSuccess: (j) => {
      toast.success(t('jobs.postedToast'));
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      navigate(`/jobs/${j.id}`);
    },
    onError: (err) => applyApiError(err, setError, t('errors.generic')),
  });
  return (
    <div className="mx-auto grid w-full max-w-[720px] gap-4">
      <BackLink to="/jobs">{t('jobs.back')}</BackLink>
      <PageHeader title={t('jobs.postTitle')} intro={t('jobs.postIntro')} />
      <Card className="p-5">
        <form className="grid gap-4" noValidate onSubmit={handleSubmit((v) => post.mutate(v))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('jobs.fields.title')} error={e.title?.message}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('title')} />
              )}
            </Field>
            <Field label={t('jobs.fields.company')} error={e.company?.message}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  {...register('company')}
                />
              )}
            </Field>
            <Field label={t('jobs.location')} error={e.location?.message}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  {...register('location')}
                />
              )}
            </Field>
            <Field label={t('jobs.fields.mode')}>
              {({ id }) => (
                <Select id={id} {...register('mode')}>
                  {JOB_MODES.map((m) => (
                    <option key={m} value={m}>
                      {t(`jobs.mode.${m}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('jobs.typeLabel')}>
              {({ id }) => (
                <Select id={id} {...register('type')}>
                  {JOB_TYPES.map((m) => (
                    <option key={m} value={m}>
                      {t(`jobs.type.${m}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('jobs.levelLabel')}>
              {({ id }) => (
                <Select id={id} {...register('level')}>
                  {JOB_LEVELS.map((m) => (
                    <option key={m} value={m}>
                      {t(`jobs.level.${m}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field
            label={t('jobs.fields.applyUrl')}
            hint={t('jobs.fields.applyUrlHint')}
            error={e.applyUrl?.message}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="url"
                placeholder="https://"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                {...register('applyUrl')}
              />
            )}
          </Field>
          <Field
            label={t('jobs.fields.description')}
            hint={t('jobs.fields.descriptionHint')}
            error={e.description?.message}
          >
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                className="min-h-[160px]"
                {...register('description')}
              />
            )}
          </Field>
          <TagInput
            label={t('jobs.skills')}
            hint={t('jobs.fields.skillsHint')}
            value={skills}
            onChange={(v) => setValue('skills', v.slice(0, 12))}
            max={12}
          />
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-[13px] font-semibold">{t('jobs.fields.branches')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {BRANCHES.map((b) => (
                <Chip
                  key={b}
                  pressed={branches.includes(b)}
                  onClick={() =>
                    setValue(
                      'branches',
                      branches.includes(b) ? branches.filter((x) => x !== b) : [...branches, b].slice(0, 6),
                    )
                  }
                >
                  {b}
                </Chip>
              ))}
            </div>
          </fieldset>
          <Checkbox id="with-salary" checked={withSalary} onChange={setWithSalary}>
            {t('jobs.fields.addSalary')}
          </Checkbox>
          {withSalary && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label={t('jobs.fields.salaryMin')}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    min={0}
                    {...register('salary.min', { valueAsNumber: true })}
                  />
                )}
              </Field>
              <Field label={t('jobs.fields.salaryMax')} error={e.salary?.max?.message}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    min={0}
                    {...register('salary.max', { valueAsNumber: true })}
                  />
                )}
              </Field>
              <Field label={t('jobs.fields.currency')}>
                {({ id }) => (
                  <Select id={id} {...register('salary.currency')} defaultValue="INR">
                    {['INR', 'USD', 'EUR', 'GBP'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('jobs.fields.period')}>
                {({ id }) => (
                  <Select id={id} {...register('salary.period')} defaultValue="year">
                    <option value="year">{t('jobs.fields.perYear')}</option>
                    <option value="month">{t('jobs.fields.perMonth')}</option>
                  </Select>
                )}
              </Field>
            </div>
          )}
          <Checkbox id="freshers" checked={!!freshersOk} onChange={(v) => setValue('freshersOk', v)}>
            {t('jobs.fields.freshersOk')}
          </Checkbox>
          <Field label={t('jobs.fields.expires')}>
            {({ id }) => (
              <Select id={id} {...register('expiresInDays', { valueAsNumber: true })}>
                {[7, 14, 30, 45, 60].map((d) => (
                  <option key={d} value={d}>
                    {t('feed.days', { count: d })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {e.root && (
            <p role="alert" className="text-sm font-medium text-danger">
              {e.root.message}
            </p>
          )}
          <Button type="submit" variant="primary" loading={post.isPending} className="justify-self-end">
            {t('jobs.publish')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
