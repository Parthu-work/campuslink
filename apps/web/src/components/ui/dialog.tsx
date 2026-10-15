import type { ReactNode } from 'react';
import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Bottom sheet on phones, centred dialog on wider screens. Radix handles focus trap and Escape. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[70] bg-[var(--scrim)] backdrop-blur-[4px] data-[state=open]:animate-[screen-in_var(--dur-base)]" />
        <D.Content
          className="fixed inset-x-0 bottom-0 z-[71] grid max-h-[88vh] gap-4 overflow-y-auto rounded-t-[var(--radius-lg)] border border-line-strong bg-surface-1 px-5 pt-5 pb-[calc(20px+env(safe-area-inset-bottom,0px))] shadow-[var(--shadow)] md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-[min(560px,calc(100vw-32px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[var(--radius-lg)] md:p-6"
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-4">
            <D.Title className="font-display text-[22px] font-semibold">{title}</D.Title>
            <D.Close
              className="-mt-1 -mr-2 grid size-11 place-items-center rounded-full text-fg-2 hover:bg-surface-2"
              aria-label={t('common.close')}
            >
              <X className="size-5" aria-hidden />
            </D.Close>
          </div>
          {description && <D.Description className="-mt-2 text-fg-2">{description}</D.Description>}
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
