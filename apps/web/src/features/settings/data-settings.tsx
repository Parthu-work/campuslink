import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Trash2, Undo2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, PasswordInput } from '../../components/ui/field';
import { Card } from '../../components/ui/misc';
import { api, apiBlob, ApiError, saveBlob } from '../../lib/api';
import { useMe } from '../../lib/me';
import { formatDay } from '../../lib/format';
import { useSignOut } from '../../lib/use-sign-out';

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
          <h2 className="text-lg font-semibold">{t('settings.data.exportTitle')}</h2>
          <p className="text-sm text-fg-2">{t('settings.data.exportBody')}</p>
        </div>
        <Button className="justify-self-start" loading={busy} onClick={() => void download()}>
          <Download className="size-4" aria-hidden /> {t('settings.data.download')}
        </Button>
      </Card>
      <Card className="grid gap-3 p-5">
        <div>
          <h2 className="text-lg font-semibold">{t('settings.data.deleteTitle')}</h2>
          <p className="text-sm text-fg-2">{t('settings.data.deleteBody')}</p>
        </div>
        {me?.deletionPurgeAt ? (
          <>
            <p className="text-sm font-semibold text-danger" role="status">
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
        <p className="text-xs text-fg-3">{t('settings.data.kept')}</p>
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
