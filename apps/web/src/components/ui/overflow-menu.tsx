import { useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { lazyPart } from '../../lib/lazy-part';

export interface OverflowItem {
  label: string;
  icon?: ReactNode;
  /** A screen to open, or an action to run (the menu closes first). */
  to?: string;
  onSelect?: () => void;
  danger?: boolean;
}

// The sheet (Radix Dialog) loads on first open, so screens with a header stay within budget.
const Sheet = lazyPart(() => import('./overflow-sheet').then((m) => m.OverflowSheet));

/**
 * A screen's secondary actions behind one "More actions" button (ADR 0015, X3): a sheet of rows,
 * on phones and desktop alike (CLAUDE.md: Sheet for menus). Every row is a 48 px target.
 */
export function OverflowMenu({ items, label }: { items: OverflowItem[]; label?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  if (!items.length) return null;
  const title = label ?? t('ui.moreActions');
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
        className="grid size-11 flex-none place-items-center rounded-[var(--radius-md)] text-fg-2 hover:bg-hover"
        aria-label={title}
        aria-haspopup="dialog"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      {opened && <Sheet open={open} onOpenChange={setOpen} title={title} items={items} />}
    </>
  );
}
