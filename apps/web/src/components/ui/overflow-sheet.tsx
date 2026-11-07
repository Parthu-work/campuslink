import type { ReactNode } from 'react';
import { useTranslation } from '../../i18n/react';
import { Sheet } from './dialog';
import { IntentLink } from './intent-link';
import { cn } from '../../lib/cn';
import type { OverflowItem } from './overflow-menu';

/** The sheets behind PageHeader's "More actions" and "About this", loaded on first open. */
export function OverflowSheet({
  open,
  onOpenChange,
  title,
  items,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  items: OverflowItem[];
}) {
  const row =
    'flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 text-left text-body font-medium hover:bg-hover [&_svg]:size-5 [&_svg]:text-fg-2';
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <ul className="grid gap-1 pb-2">
        {items.map((item) => (
          <li key={item.label}>
            {item.to ? (
              <IntentLink
                to={item.to}
                className={cn(row, item.danger && 'text-danger-ink')}
                onClick={() => onOpenChange(false)}
              >
                {item.icon}
                {item.label}
              </IntentLink>
            ) : (
              <button
                type="button"
                className={cn(row, item.danger && 'text-danger-ink')}
                onClick={() => {
                  onOpenChange(false);
                  item.onSelect?.();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export function AboutSheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <div className="grid gap-3 pb-4 text-body text-fg-2">{children}</div>
    </Sheet>
  );
}

/** PageHeader's two sheets ("About this" and "More actions"), one module loaded on first tap. */
export function HeaderSheets({
  which,
  onClose,
  about,
  items,
}: {
  which: 'about' | 'more' | null;
  onClose: () => void;
  about: ReactNode;
  items: OverflowItem[];
}) {
  const { t } = useTranslation();
  const change = (o: boolean) => !o && onClose();
  return (
    <>
      {about != null && (
        <AboutSheet open={which === 'about'} onOpenChange={change} title={t('ui.aboutThis')}>
          {about}
        </AboutSheet>
      )}
      {items.length > 0 && (
        <OverflowSheet
          open={which === 'more'}
          onOpenChange={change}
          title={t('ui.moreActions')}
          items={items}
        />
      )}
    </>
  );
}
