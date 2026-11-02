import { useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { Download, Trash2, Undo2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, PasswordInput } from '../../components/ui/field';
import { Card } from '../../components/ui/misc';
import { api, apiBlob, ApiError, saveBlob } from '../../lib/api';
import { useMe } from '../../lib/me';
import { formatDay } from '../../lib/format';
import { useSignOut } from '../../lib/use-sign-out';
import { cn } from '../../lib/cn';

const DAY = 86_400_000;

/**
 * What deleting an account does, as a timeline (§8.13): today, the grace period (sign in to cancel)
 * and the day the data is erased. When a deletion is pending, the member's place on it is marked.
 */
function DeletionTimeline({ purgeAt }: { purgeAt: string | null }) {
  const { t } = useTranslation();
  const [now] = useState(() => Date.now());
  const left = purgeAt ? Math.max(0, Math.ceil((new Date(purgeAt).getTime() - now) / DAY)) : null;
  const steps: { title: string; body: string; state: 'done' | 'current' | 'next' }[] = [
    {
      title: purgeAt ? t('settings.data.tl.requested') : t('settings.data.tl.today'),
      body: t('settings.data.tl.todayBody'),
      state: purgeAt ? 'done' : 'current',
    },
    {
      title: left !== null ? t('settings.data.tl.graceLeft', { count: left }) : t('settings.data.tl.grace'),
      body: t('settings.data.tl.graceBody'),
      state: purgeAt ? 'current' : 'next',
    },
    {
      title: purgeAt
        ? t('settings.data.tl.erasedOn', { date: formatDay(purgeAt) })
        : t('settings.data.tl.erased'),
      body: t('settings.data.tl.erasedBody'),
      state: 'next',
    },
  ];
  return (
    <ol className="grid gap-0" aria-label={t('settings.data.tl.label')}>
      {steps.map((st, i) => (
        <li key={st.title} className="grid grid-cols-[1.75rem_1fr] gap-3">
          <div className="flex flex-col items-center" aria-hidden>
            <span
              className={cn(
                'mt-0.5 grid size-7 flex-none place-items-center rounded-full text-caption font-bold',
                st.state === 'current'
                  ? 'bg-danger text-on-danger'
                  : st.state === 'done'
                    ? 'bg-surface-3 text-fg-2'
                    : 'border border-line-strong text-fg-3',
              )}
            >
              {i + 1}
            </span>
            {i < steps.length - 1 && <span className="my-1 w-0.5 flex-1 rounded-full bg-line-strong" />}
          </div>
          <div className={cn('grid gap-0.5 pb-4', i === steps.length - 1 && 'pb-0')}>
            <p className="font-semibold">
              {st.title}
              {st.state === 'current' && purgeAt && (
                <span className="sr-only"> ({t('settings.data.tl.now')})</span>
              )}
            </p>
            <p className="text-meta text-fg-2">{st.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function DataSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const download = async () => {
    setBusy(true);
    try {
      saveBlob(await apiBlob('/me/export'), 'my-data.json');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const del = useMutation({
    mutationFn: () => api.post('/me/deletion', { password }),
    onSuccess: () => {
      setOpen(false);
      toast.success(t('settings.data.scheduled'));
      // Every session was signed out on the server.
      void signOut();
    },
    onError: fail,
  });
  const cancel = useMutation({
    mutationFn: () => api.delete('/me/deletion'),
    onSuccess: () => {
      toast.success(t('settings.data.cancelled'));
      void qc.invalidateQueries();
    },
    onError: fail,
  });
  return (
    <div className="grid gap-4">
      <Card className="grid gap-3 p-5">
        <div>
          <h2 className="text-title font-semibold">{t('settings.data.exportTitle')}</h2>
          <p className="text-meta text-fg-2">{t('settings.data.exportBody')}</p>
        </div>
        <Button className="justify-self-start" loading={busy} onClick={() => void download()}>
          <Download className="size-4" aria-hidden /> {t('settings.data.download')}
        </Button>
      </Card>
      <Card className="grid gap-3 p-5">
        <div>
          <h2 className="text-title font-semibold">{t('settings.data.deleteTitle')}</h2>
          <p className="text-meta text-fg-2">{t('settings.data.deleteBody')}</p>
        </div>
        <DeletionTimeline purgeAt={me?.deletionPurgeAt ?? null} />
        {me?.deletionPurgeAt ? (
          <>
            <p className="text-meta font-semibold text-danger" role="status">
              {t('settings.data.pending', { date: formatDay(me.deletionPurgeAt) })}
            </p>
            <Button className="justify-self-start" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              <Undo2 className="size-4" aria-hidden /> {t('settings.data.cancel')}
            </Button>
          </>
        ) : (
          <Button variant="danger" className="justify-self-start" onClick={() => setOpen(true)}>
            <Trash2 className="size-4" aria-hidden /> {t('settings.data.delete')}
          </Button>
        )}
        <p className="text-caption text-fg-3">{t('settings.data.kept')}</p>
      </Card>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('settings.data.confirmTitle')}
        description={t('settings.data.confirmBody')}
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) del.mutate();
          }}
        >
          <Field label={t('settings.data.password')}>
            {(f) => (
              <PasswordInput
                id={f.id}
                aria-describedby={f.describedBy}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={del.isPending} disabled={!password}>
              {t('settings.data.confirm')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
