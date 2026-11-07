import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toLocale, type SsoPendingView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { AuthLayout, FormError } from '../../components/layout/auth-layout';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Chip, Skeleton } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { BirthMonthField, ConsentFields } from '../auth/phone-parts';

/**
 * /sign-up/sso (prompt 2, G9): the first single sign-on of someone without an account. The
 * identity provider gave the name and a confirmed address; the rest is sign-up's (the role, the
 * birth month and the terms). The one-time ticket stays in the address fragment, never sent.
 */
export function SsoCompletePage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setToken = useSession((s) => s.setToken);
  const [ticket] = useState(
    () => /(?:^#|&)ticket=([A-Za-z0-9_-]{32,64})/.exec(window.location.hash)?.[1] ?? '',
  );
  const who = useQuery({
    queryKey: ['sso-pending', ticket],
    queryFn: () => api.post<SsoPendingView>('/auth/sso/pending', { ticket }),
    enabled: !!ticket,
    retry: false,
    staleTime: Infinity,
  });
  const [intent, setIntent] = useState<'STUDENT' | 'ALUMNI'>('STUDENT');
  const [birthMonth, setBirthMonth] = useState('');
  const [consents, setConsents] = useState<string[]>(['account', 'mentorship_matching']);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.post<{ session: { accessToken: string } }>('/auth/sso/complete', {
        ticket,
        intent,
        birthMonth,
        consents,
        locale: toLocale(i18n.language),
      });
      setToken(r.session.accessToken);
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/home', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };
  if (!ticket || who.isError)
    return (
      <AuthLayout title={t('reach.complete.title')} subtitle={t('reach.complete.expired')}>
        <Link to="/sign-in" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
          {t('reach.complete.back')}
        </Link>
      </AuthLayout>
    );
  if (!who.data) return <Skeleton className="h-64" />;
  return (
    <AuthLayout
      title={t('reach.complete.title')}
      subtitle={t('reach.complete.sub', {
        email: who.data.email,
        provider: t(`reach.sso.${who.data.provider}`),
      })}
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormError message={error} />
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-callout font-semibold">{t('auth.iAm')}</legend>
          <div className="flex gap-2">
            {(['STUDENT', 'ALUMNI'] as const).map((v) => (
              <Chip key={v} pressed={intent === v} onClick={() => setIntent(v)}>
                {v === 'STUDENT' ? t('auth.student') : t('auth.alumnus')}
              </Chip>
            ))}
          </div>
        </fieldset>
        <BirthMonthField value={birthMonth} onChange={setBirthMonth} />
        <ConsentFields value={consents} onChange={setConsents} />
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!birthMonth}>
          {t('reach.complete.cta')}
        </Button>
      </form>
    </AuthLayout>
  );
}
