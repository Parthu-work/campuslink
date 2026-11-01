import { useState } from 'react';
import type { SupportTicketView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Field, Textarea } from '../../components/ui/field';
import { Badge, Card } from '../../components/ui/misc';
import { formatDateTime } from '../../lib/format';
import { cn } from '../../lib/cn';
import { SUPPORT_STATUS_TONE } from '../../lib/support';

/**
 * One problem report and its replies, with a reply box and close / reopen (B14). The member, the
 * college's desk and the platform's desk all see the same thread; `onReply` and `onStatus` decide
 * which API they call.
 */
export function TicketThread({
  ticket: tk,
  screenshotUrl,
  onReply,
  onStatus,
  replying,
}: {
  ticket: SupportTicketView;
  screenshotUrl?: string | undefined;
  onReply: (body: string) => Promise<unknown>;
  onStatus: (status: 'open' | 'closed') => void;
  replying: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SUPPORT_STATUS_TONE[tk.status]}>{t(`help.status.${tk.status}`)}</Badge>
        <span className="text-meta text-fg-2">
          {t(`help.category.${tk.category}`)} · {t(`help.desk.${tk.desk}`)}
        </span>
      </div>
      <Card className="grid gap-2 p-4">
        <p className="text-caption text-fg-3">
          {tk.reporter?.name ?? t('placements.admin.formerMember')} · {formatDateTime(tk.createdAt)}
        </p>
        <p className="whitespace-pre-wrap text-body">{tk.body}</p>
        {screenshotUrl && (
          <img
            src={screenshotUrl}
            alt={t('help.screenshotAlt')}
            className="max-h-80 w-auto rounded-[var(--radius-md)] border border-line object-contain"
          />
        )}
      </Card>
      {tk.replies.length > 0 && (
        <ol className="grid gap-3" aria-label={t('help.replies')}>
          {tk.replies.map((r) => (
            <li
              key={r.id}
              className={cn(
                'grid gap-1 rounded-[var(--radius-md)] p-3',
                r.from === 'member' ? 'bg-surface-2' : 'bg-brand-surface',
              )}
            >
              <p className="text-caption text-fg-3">
                {r.from === 'member' ? r.name : t(`help.from.${r.from}`, { name: r.name })} ·{' '}
                {formatDateTime(r.at)}
              </p>
              <p className="whitespace-pre-wrap text-body">{r.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void onReply(text.trim()).then(() => setText(''));
        }}
      >
        <Field label={t('help.reply')}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" type="submit" loading={replying} disabled={!text.trim()}>
            {t('help.sendReply')}
          </Button>
          {tk.status === 'closed' ? (
            <Button variant="ghost" onClick={() => onStatus('open')}>
              {t('help.reopen')}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => onStatus('closed')}>
              {t('help.close')}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
