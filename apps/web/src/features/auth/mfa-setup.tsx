import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/misc';
import { OtpInput } from '../../components/ui/otp';
import { FormError } from '../../components/layout/auth-layout';
import { api, ApiError } from '../../lib/api';

interface Setup {
  otpauthUri: string;
  qrSvg: string;
  secret: string;
}

/** TOTP enrolment. The QR SVG is rendered through <img> (data URI) so no markup is ever injected. */
export function MfaSetup({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .post<Setup>('/auth/mfa/setup')
      .then(setSetup)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : t('errors.generic')));
  }, [t]);

  const enable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code });
      setCodes(r.recoveryCodes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <div className="grid gap-4">
        <h2 className="text-xl font-semibold">{t('mfa.codesTitle')}</h2>
        <p className="text-fg-2">{t('mfa.codesBody')}</p>
        <ul className="grid grid-cols-2 gap-2 rounded-[var(--radius-md)] bg-surface-2 p-4 font-mono text-[15px] tabular sm:grid-cols-2">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void navigator.clipboard?.writeText(codes.join('\n')).catch(() => undefined)}
          >
            <Copy className="size-4" aria-hidden /> {t('common.copy')}
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              await qc.invalidateQueries({ queryKey: ['me'] });
              onDone();
            }}
          >
            {t('mfa.codesConfirm')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={enable} className="grid gap-5">
      <FormError message={error} />
      <ol className="grid gap-5">
        <li className="grid gap-3">
          <p>
            <span className="eyebrow mr-2">1</span>
            {t('mfa.step1')}
          </p>
          {setup ? (
            <Card className="grid w-fit gap-3 p-4">
              <img
                src={`data:image/svg+xml;base64,${btoa(setup.qrSvg)}`}
                alt=""
                width={184}
                height={184}
                className="rounded-[var(--radius-sm)] bg-white p-2"
              />
              <p className="text-xs text-fg-2">{t('mfa.manual')}</p>
              <code className="flex items-center gap-2 font-mono text-sm break-all">
                <KeyRound className="size-4 flex-none text-fg-3" aria-hidden />
                {setup.secret.match(/.{1,4}/g)?.join(' ')}
              </code>
            </Card>
          ) : (
            <div
              className="size-[216px] animate-pulse rounded-[var(--radius-md)] bg-surface-2 motion-reduce:animate-none"
              aria-label={t('common.loading')}
            />
          )}
        </li>
        <li className="grid gap-3">
          <p>
            <span className="eyebrow mr-2">2</span>
            {t('mfa.step2')}
          </p>
          <OtpInput value={code} onChange={setCode} label={t('auth.mfaTitle')} />
        </li>
      </ol>
      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={busy}
        disabled={code.length !== 6 || !setup}
        className="justify-self-start"
      >
        {t('mfa.enable')}
      </Button>
    </form>
  );
}
