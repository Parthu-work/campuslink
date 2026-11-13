import { useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DropdownMenu } from 'radix-ui';
import { toast } from '../../lib/toast';
import { Ban, Flag, MoreHorizontal, Sparkles, Trash2 } from 'lucide-react';
import { REPORT_REASONS, type ContentTarget } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Select, Textarea } from '../../components/ui/field';
import { api, ApiError } from '../../lib/api';
import { useCan } from '../../lib/me';
import type { ContentMenuProps } from './content-menu';

const menuItem =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-3 text-callout outline-none data-[highlighted]:bg-surface-2';

/** The menu itself and its dialogs (`ContentMenu` loads it on first use, open). */
export function ContentMenuPanel({
  targetType,
  targetId,
  authorId,
  authorName,
  isMine,
  onDelete,
  deleting,
  featurable,
  blockable = true,
  label,
}: ContentMenuProps & { label: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canFeature = useCan('announcements:post');
  const canReport = useCan('content:report');
  const [dialog, setDialog] = useState<'report' | 'block' | 'delete' | null>(null);
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>('spam');
  const [note, setNote] = useState('');
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const report = useMutation({
    mutationFn: () =>
      api.post('/reports', { targetType, targetId, reason, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      toast.success(t('safety.reported'));
      setDialog(null);
      setNote('');
    },
    onError: fail,
  });
  const block = useMutation({
    mutationFn: () => api.post('/me/blocks', { userId: authorId }),
    onSuccess: () => {
      toast.success(t('safety.blocked', { name: authorName }));
      setDialog(null);
      void qc.invalidateQueries();
    },
    onError: fail,
  });
  const feature = useMutation({
    mutationFn: () => api.post('/feed/one-useful-thing', { targetType: 'post', targetId }),
    onSuccess: () => {
      toast.success(t('feed.featured'));
      void qc.invalidateQueries({ queryKey: ['out'] });
    },
    onError: fail,
  });
  return (
    <>
      <DropdownMenu.Root defaultOpen>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('content.menu', { what: label })}>
            <MoreHorizontal className="size-5" aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-[80] min-w-52 rounded-[var(--radius-md)] border border-line-strong bg-surface-1 p-1 shadow-[var(--shadow)]"
          >
            {featurable && canFeature && (
              <DropdownMenu.Item onSelect={() => feature.mutate()} className={menuItem}>
                <Sparkles className="size-4" aria-hidden /> {t('feed.feature')}
              </DropdownMenu.Item>
            )}
            {isMine && onDelete ? (
              <DropdownMenu.Item onSelect={() => setDialog('delete')} className={`${menuItem} text-danger`}>
                <Trash2 className="size-4" aria-hidden /> {t('content.delete', { what: label })}
              </DropdownMenu.Item>
            ) : (
              !isMine && (
                <>
                  {canReport && (
                    <DropdownMenu.Item onSelect={() => setDialog('report')} className={menuItem}>
                      <Flag className="size-4" aria-hidden /> {t('content.report', { what: label })}
                    </DropdownMenu.Item>
                  )}
                  {blockable && (
                    <DropdownMenu.Item
                      onSelect={() => setDialog('block')}
                      className={`${menuItem} text-danger`}
                    >
                      <Ban className="size-4" aria-hidden /> {t('safety.block', { name: authorName })}
                    </DropdownMenu.Item>
                  )}
                </>
              )
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Dialog
        open={dialog === 'delete'}
        onOpenChange={(o) => setDialog(o ? 'delete' : null)}
        title={t('content.deleteTitle', { what: label })}
        description={t('content.deleteBody')}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            loading={!!deleting}
            onClick={() => {
              onDelete?.();
              setDialog(null);
            }}
          >
            {t('content.deleteConfirm')}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={dialog === 'block'}
        onOpenChange={(o) => setDialog(o ? 'block' : null)}
        title={t('safety.blockTitle', { name: authorName })}
        description={t('content.blockBody')}
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
        description={t('content.reportBody')}
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

/** The appeal form for removed content (`RemovalNotice` loads it when the author asks to appeal). */
export function AppealDialog({
  targetType,
  targetId,
  open,
  onOpenChange,
}: {
  targetType: ContentTarget;
  targetId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const appeal = useMutation({
    mutationFn: () => api.post('/appeals', { targetType, targetId, message: message.trim() }),
    onSuccess: () => {
      toast.success(t('mod.appealSent'));
      onOpenChange(false);
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('mod.appealTitle')}
      description={t('mod.appealBody')}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          appeal.mutate();
        }}
      >
        <Field label={t('mod.appealMessage')} hint={t('mod.appealHint')}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              minLength={10}
              maxLength={1000}
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            type="submit"
            variant="primary"
            loading={appeal.isPending}
            disabled={message.trim().length < 10}
          >
            {t('mod.sendAppeal')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
