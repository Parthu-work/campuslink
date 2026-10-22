import { useTranslation } from 'react-i18next';
import { AuthLayout } from '../../components/layout/auth-layout';
import { MfaSetup } from './mfa-setup';

/** The "turn on two-factor authentication" step that admins see once (loaded only then). */
export function MfaGate() {
  const { t } = useTranslation();
  return (
    <AuthLayout title={t('mfa.setupTitle')} subtitle={t('mfa.setupWhy')}>
      <MfaSetup onDone={() => undefined} />
    </AuthLayout>
  );
}
