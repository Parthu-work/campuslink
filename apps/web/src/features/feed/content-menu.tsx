import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DropdownMenu } from 'radix-ui';
import { toast } from 'sonner';
import { Ban, Flag, MoreHorizontal, Sparkles, Trash2 } from 'lucide-react';
import { REPORT_REASONS, type ContentTarget, type RemovalView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Select, Textarea } from '../../components/ui/field';
import { api, ApiError } from '../../lib/api';
import { useCan } from '../../lib/me';
import { formatRelative } from '../../lib/format';

const menuItem =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-3 text-sm outline-none data-[highlighted]:bg-surface-2';

/** Report, block, delete and (staff) feature: one menu for posts, comments, questions, answers, stories. */
export function ContentMenu({
  targetType,
  targetId,
  authorId,
  authorName,
  isMine,
  onDelete,
  deleting,
  featurable,
  blockable = true,
}: {
  targetType: Exclude<ContentTarget, 'item'>;
  targetId: string;
  authorId: string;
  authorName: string;
  isMine: boolean;
  onDelete?: () => void;
  deleting?: boolean;
  featurable?: boolean;
  /** False for content without a member author (library roadmaps). */
  blockable?: boolean;
}) {
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
  const label = t(`content.${targetType}`);
  if (isMine && !onDelete && !(featurable && canFeature)) return null;
  return (
    <>
      <DropdownMenu.Root>
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

/** What the author (and moderators) see on removed content: the reason, and a way to appeal once. */
export function RemovalNotice({
  targetType,
  targetId,
  removal,
  canAppeal,
}: {
  targetType: ContentTarget;
  targetId: string;
  removal: RemovalView;
  canAppeal: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const appeal = useMutation({
    mutationFn: () => api.post('/appeals', { targetType, targetId, message: message.trim() }),
    onSuccess: () => {
      toast.success(t('mod.appealSent'));
      setOpen(false);
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const a = removal.appeal;
  return (
    <div
      role="note"
      className="grid gap-1.5 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--warning)_45%,var(--line))] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] p-3 text-sm"
    >
      <b>{t('mod.removedTitle', { reason: t(`mod.reasons.${removal.reason}`) })}</b>
      <p className="text-fg-2">
        {t('mod.removedBody', { when: formatRelative(removal.at) })}
        {removal.note && (
          <>
            {' '}
            {t('mod.moderatorNote')} “{removal.note}”
          </>
        )}
      </p>
      {a ? (
        <p className="text-fg-2">
          {t(`mod.appeal_${a.status}`)}
          {a.decisionNote && <> “{a.decisionNote}”</>}
        </p>
      ) : (
        canAppeal && (
          <div>
            <Button size="sm" onClick={() => setOpen(true)}>
              {t('mod.appeal')}
            </Button>
          </div>
        )
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
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
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
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
    </div>
  );
}
