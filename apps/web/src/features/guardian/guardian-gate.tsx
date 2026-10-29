import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Clock, ShieldCheck } from 'lucide-react';
import {
  phone as phoneSchema,
  type CodeSent,
  type GuardianStatus,
  type OtpChannel,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { AuthLayout, FormError } from '../../components/layout/auth-layout';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Segmented } from '../../components/ui/tab-nav';
import { api, ApiError } from '../../lib/api';
import { toE164 } from '../../lib/phone';
import { useSignOut } from '../../lib/use-sign-out';
import { PhoneCodeStep, PhoneField } from '../auth/phone-parts';
import { GUARDIAN_DECLARATION, type DeclarationLanguage } from './declaration';

/**
 * Members under 18 wait here until a parent or guardian consents (B2, DPDP Rules 2025 Rule 10).
 * The code goes to the guardian's number on the college's record; the guardian reads the
 * declaration on this screen, in their language, and enters the code they received.
 */
export function GuardianGate() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const signOut = useSignOut();
  const status = useQuery({ queryKey: ['guardian'], queryFn: () => api.get<GuardianStatus>('/me/guardian') });
  const [lang, setLang] = useState<DeclarationLanguage>(i18n.language === 'te' ? 'te' : 'en');
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [number, setNumber] = useState('');
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['me'] });
  };
  const send = (channel?: OtpChannel) => api.post<CodeSent>('/me/guardian/start', channel ? { channel } : {});
  const s = status.data;

  const body = (() => {
    if (!s) return <Skeleton className="h-48" />;
    if (!s.rosterMatched)
      return (
        <EmptyState
          icon={<BadgeCheck className="size-6" />}
          title={t('guardian.verifyFirstTitle')}
          action={
            <Link to="/verify" className={buttonVariants({ variant: 'primary' })}>
              {t('home.verifyCta')}
            </Link>
          }
        >
          {t('guardian.verifyFirstBody')}
        </EmptyState>
      );
    if (!s.guardianPhone)
      return s.manualPending ? (
        <EmptyState icon={<Clock className="size-6" />} title={t('guardian.checkingTitle')}>
          {t('guardian.checkingBody')}
        </EmptyState>
      ) : (
        <form
          noValidate
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const p = toE164(number);
            if (!phoneSchema.safeParse(p).success) return setError(t('phone.invalid'));
            setBusy(true);
            setError(undefined);
            try {
              await api.post('/me/guardian/manual', { phone: p });
              await status.refetch();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : t('errors.generic'));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-fg-2">{t('guardian.noNumberBody')}</p>
          <PhoneField label={t('guardian.number')} value={number} onChange={setNumber} error={error} />
          <Button type="submit" variant="primary" size="lg" loading={busy}>
            {t('guardian.askCollege')}
          </Button>
        </form>
      );
    return (
      <div className="grid gap-4">
        <Card className="grid gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-title font-semibold">{t('guardian.declarationTitle')}</h2>
            <Segmented<DeclarationLanguage>
              label={t('guardian.language')}
              value={lang}
              options={[
                ['en', 'English'],
                ['te', 'తెలుగు'],
              ]}
              onChange={setLang}
            />
          </div>
          <ul lang={lang} className="grid list-disc gap-2 pl-5 text-body">
            {GUARDIAN_DECLARATION[lang].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="text-caption text-fg-3">
            {t('guardian.version', { version: GUARDIAN_DECLARATION.version })}
          </p>
        </Card>
        {sent ? (
          <PhoneCodeStep
            phone={s.guardianPhone}
            sent={sent}
            onResend={send}
            onBack={() => setSent(null)}
            onCode={async (code, challengeId) => {
              await api.post('/me/guardian/confirm', { challengeId, code, language: lang });
              await done();
            }}
          />
        ) : (
          <>
            <FormError message={error} />
            <Button
              variant="primary"
              size="lg"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                try {
                  setSent(await send());
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : t('errors.generic'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('guardian.sendCode', { phone: s.guardianPhone })}
            </Button>
          </>
        )}
      </div>
    );
  })();

  return (
    <AuthLayout title={t('guardian.title')} subtitle={t('guardian.intro')}>
      <p className="flex items-start gap-2 text-meta text-fg-2">
        <ShieldCheck className="mt-0.5 size-4 flex-none text-brand-ink" aria-hidden />
        {t('guardian.why')}
      </p>
      {body}
      <Button variant="ghost" onClick={() => void signOut()}>
        {t('common.signOut')}
      </Button>
    </AuthLayout>
  );
}
