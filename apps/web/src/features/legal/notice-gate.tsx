import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ScrollText } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { useSignOut } from '../../lib/use-sign-out';

/**
 * The college published a new privacy notice or terms (B14): the member accepts it before using
 * the app again. Both documents open in their own pages; nothing else is reachable until then.
 */
export function NoticeGate({ version }: { version: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const signOut = useSignOut();
  const [error, setError] = useState('');
  const accept = useMutation({
    mutationFn: () => api.post('/me/notice', { version }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : t('errors.generic'));
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  return (
    <main id="main" className="gutter grid min-h-dvh place-items-center py-8">
      <Card className="grid w-full max-w-[560px] gap-4 p-6">
        <span
          className="grid size-11 place-items-center rounded-full bg-brand-surface text-brand-ink"
          aria-hidden
        >
          <ScrollText className="size-5" />
        </span>
        <h1 className="text-headline font-semibold">{t('legal.gateTitle')}</h1>
        <p className="text-body text-fg-2">{t('legal.gateBody')}</p>
        <ul className="grid gap-2 text-body">
          <li>
            <Link
              to="/legal/privacy"
              target="_blank"
              className="inline-flex min-h-11 items-center font-semibold text-brand-ink underline underline-offset-2"
            >
              {t('legal.privacy')}
            </Link>
          </li>
          <li>
            <Link
              to="/legal/terms"
              target="_blank"
              className="inline-flex min-h-11 items-center font-semibold text-brand-ink underline underline-offset-2"
            >
              {t('legal.terms')}
            </Link>
          </li>
        </ul>
        {error && (
          <p role="alert" className="text-callout text-danger-ink">
            {error}
          </p>
        )}
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button variant="primary" loading={accept.isPending} onClick={() => accept.mutate()}>
            {t('legal.agree')}
          </Button>
          <Button variant="ghost" onClick={() => void signOut()}>
            {t('common.signOut')}
          </Button>
        </div>
      </Card>
    </main>
  );
}
