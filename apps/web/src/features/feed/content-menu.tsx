import { useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { MoreHorizontal } from 'lucide-react';
import type { ContentTarget, RemovalView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { useCan } from '../../lib/me';
import { formatRelative } from '../../lib/format';
import { lazyPart } from '../../lib/lazy-part';

// The menu (Radix, floating-ui) and its dialogs load on first use, not with every list of posts
// (prompt 3, F6: 30 KB off Home). Pointing at or focusing the button starts the load.
const ContentMenuPanel = lazyPart(() => import('./content-menu-panel').then((m) => m.ContentMenuPanel));
const AppealDialog = lazyPart(() => import('./content-menu-panel').then((m) => m.AppealDialog));

export interface ContentMenuProps {
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
  /** The content's name in the menu, when its strings come from a language pack (prompt 2). */
  what?: string;
}

/** Report, block, delete and (staff) feature: one menu for posts, comments, questions, answers, stories. */
export function ContentMenu({ what, ...props }: ContentMenuProps) {
  const { t } = useTranslation();
  const canFeature = useCan('announcements:post');
  const [used, setUsed] = useState(false);
  const label = what ?? t(`content.${props.targetType}`);
  if (props.isMine && !props.onDelete && !(props.featurable && canFeature)) return null;
  const button = (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('content.menu', { what: label })}
      aria-haspopup="menu"
      onClick={() => setUsed(true)}
      onPointerEnter={() => void ContentMenuPanel.preload()}
      onFocus={() => void ContentMenuPanel.preload()}
    >
      <MoreHorizontal className="size-5" aria-hidden />
    </Button>
  );
  // Once used, the real menu takes the button's place, open; from then on it is an ordinary menu.
  return used ? <ContentMenuPanel {...props} label={label} fallback={button} /> : button;
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
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const a = removal.appeal;
  return (
    <div
      role="note"
      className="grid gap-1.5 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--warning)_45%,var(--line))] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] p-3 text-callout"
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
            <Button
              size="sm"
              onClick={() => {
                setAsked(true);
                setOpen(true);
              }}
            >
              {t('mod.appeal')}
            </Button>
          </div>
        )
      )}
      {asked && (
        <AppealDialog targetType={targetType} targetId={targetId} open={open} onOpenChange={setOpen} />
      )}
    </div>
  );
}
