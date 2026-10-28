import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DropdownMenu } from 'radix-ui';
import { toast } from '../../lib/toast';
import { Ban, Flag, MoreHorizontal } from 'lucide-react';
import { REPORT_REASONS } from '@campuslink/shared';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Field, Select, Textarea } from '../ui/field';
import { api, ApiError } from '../../lib/api';

/** Block and report, offered on every interaction (people, messages, requests). */
export function SafetyMenu({
  userId,
  name,
  target,
}: {
  userId: string;
  name: string;
  /** What "Report" reports; defaults to the person. */
  target?: { type: 'message' | 'request'; id: string };
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'block' | 'report' | null>(null);
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>('spam');
  const [note, setNote] = useState('');
  const block = useMutation({
    mutationFn: () => api.post('/me/blocks', { userId }),
    onSuccess: () => {
      toast.success(t('safety.blocked', { name }));
      setDialog(null);
      void qc.invalidateQueries();
    },
  });
  const report = useMutation({
    mutationFn: () =>
      api.post('/reports', {
        targetType: target?.type ?? 'user',
        targetId: target?.id ?? userId,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success(t('safety.reported'));
      setDialog(null);
      setNote('');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('safety.menu', { name })}>
            <MoreHorizontal className="size-5" aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-[80] min-w-48 rounded-[var(--radius-md)] border border-line-strong bg-surface-1 p-1 shadow-[var(--shadow)]"
          >
            <DropdownMenu.Item
              onSelect={() => setDialog('report')}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-3 text-meta outline-none data-[highlighted]:bg-surface-2"
            >
              <Flag className="size-4" aria-hidden />{' '}
              {target ? t(`safety.report_${target.type}`) : t('safety.reportPerson')}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => setDialog('block')}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-3 text-meta text-danger outline-none data-[highlighted]:bg-surface-2"
            >
              <Ban className="size-4" aria-hidden /> {t('safety.block', { name })}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Dialog
        open={dialog === 'block'}
        onOpenChange={(o) => setDialog(o ? 'block' : null)}
        title={t('safety.blockTitle', { name })}
        description={t('safety.blockBody')}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={block.isPending} onClick={() => block.mutate()}>
            {t('safety.blockConfirm')}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={dialog === 'report'}
        onOpenChange={(o) => setDialog(o ? 'report' : null)}
        title={t('safety.reportTitle')}
        description={t('safety.reportBody')}
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            report.mutate();
          }}
        >
          <Field label={t('safety.reason')}>
            {({ id }) => (
              <Select id={id} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
                {REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`safety.reasons.${r}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('safety.note')} hint={t('safety.noteHint')}>
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" loading={report.isPending}>
              {t('safety.send')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
