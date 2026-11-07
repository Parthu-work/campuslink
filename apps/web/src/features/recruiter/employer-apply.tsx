import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Building2, MailCheck } from 'lucide-react';
import { APP_NAME, EMPLOYER_SLUG_PREFIX, isFreeMailDomain, isValidGstin } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/field';
import { Card, EmptyState } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { api, ApiError } from '../../lib/api';

const FIELDS = ['companyName', 'legalName', 'domain', 'gstin', 'slug', 'name', 'email'] as const;
type Form = Record<(typeof FIELDS)[number], string>;

/** `/employers/apply` on the platform host (prompt 2, G12): a company asks to join; a person approves. */
export function EmployerApplyPage() {
  const { t } = useTranslation();
  const [f, setF] = useState<Form>({
    companyName: '',
    legalName: '',
    domain: '',
    gstin: '',
    slug: EMPLOYER_SLUG_PREFIX,
    name: '',
    email: '',
  });
  const [error, setError] = useState<string | null>(null);
  const apply = useMutation({
    mutationFn: () => api.post<{ slug: string }>('/employers/apply', f),
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const domain = f.domain.trim().toLowerCase();
  const problems = {
    domain: domain && isFreeMailDomain(domain) ? t('recruiter.apply.freeMail') : null,
    gstin: f.gstin && !isValidGstin(f.gstin) ? t('recruiter.apply.badGstin') : null,
    email:
      f.email && domain && !f.email.toLowerCase().endsWith(`@${domain}`)
        ? t('recruiter.apply.emailDomain', { domain })
        : null,
    slug: !f.slug.startsWith(EMPLOYER_SLUG_PREFIX)
      ? t('recruiter.apply.slug', { prefix: EMPLOYER_SLUG_PREFIX })
      : null,
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (Object.values(problems).some(Boolean)) return;
    apply.mutate();
  };
  if (apply.isSuccess)
    return (
      <main className="mx-auto grid max-w-xl gap-5 px-4 py-10">
        <EmptyState icon={<MailCheck />} title={t('recruiter.apply.doneTitle')}>
          {t('recruiter.apply.doneBody', {
            email: f.email,
            host: `${apply.data.slug}.${window.location.host.split('.').slice(1).join('.')}`,
          })}
        </EmptyState>
      </main>
    );
  return (
    <main className="mx-auto grid max-w-xl gap-5 px-4 py-10">
      <PageHeader
        title={t('recruiter.apply.title', { app: APP_NAME })}
        icon={<Building2 />}
        intro={t('recruiter.apply.intro')}
      />
      <Card variant="raised" className="p-4 sm:p-6">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {FIELDS.map((k) => (
            <Field
              key={k}
              label={t(`recruiter.apply.fields.${k}`)}
              hint={
                k === 'gstin'
                  ? t('recruiter.apply.gstinHint')
                  : k === 'slug'
                    ? t('recruiter.apply.slugHint')
                    : undefined
              }
              error={(problems as Record<string, string | null>)[k] ?? undefined}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  required
                  type={k === 'email' ? 'email' : 'text'}
                  autoComplete={k === 'email' ? 'email' : k === 'name' ? 'name' : 'off'}
                  value={f[k]}
                  onChange={(e) => setF({ ...f, [k]: e.target.value })}
                />
              )}
            </Field>
          ))}
          <p className="text-caption text-fg-3">{t('recruiter.apply.privacy')}</p>
          {error && (
            <p role="alert" className="text-meta font-medium text-danger-ink">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" loading={apply.isPending}>
            {t('recruiter.apply.submit')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
