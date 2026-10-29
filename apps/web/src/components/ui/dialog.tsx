import type { ReactNode } from 'react';
import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { cn } from '../../lib/cn';
import { useDialogHistory } from '../../lib/use-dialog-history';
import { useDragDismiss } from '../../lib/use-drag-dismiss';

interface OverlayProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Actions pinned under the scrolling body (Save, Cancel), always in reach. */
  footer?: ReactNode;
  /** Back closes it (a history entry). Off when the caller keeps the open state in the URL. */
  history?: boolean;
}

/**
 * A focused task or confirmation: a bottom sheet on phones, centred on wider screens. Radix traps
 * focus and handles Escape; Back closes it; on phones it swipes down to close (DS-5).
 */
export function Dialog(props: OverlayProps) {
  return (
    <Overlay
      {...props}
      className="sheet-motion md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[min(88dvh,820px)] md:w-[min(560px,calc(100vw-32px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[var(--radius-xl)] md:border-b"
    />
  );
}

/**
 * Menus, filters and pickers that sit beside the screen: a bottom sheet on phones, a side sheet
 * from the right on wider screens (design brief, audit DS-5). Same behaviour as Dialog.
 */
export function Sheet(props: OverlayProps) {
  return (
    <Overlay
      {...props}
      className="side-sheet-motion md:top-0 md:left-auto md:max-h-none md:w-[min(440px,calc(100vw-48px))] md:rounded-tr-none md:rounded-l-[var(--radius-xl)] md:border-r-0 md:border-b"
    />
  );
}

function Overlay({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  history = true,
  className,
}: OverlayProps & { className: string }) {
  const { t } = useTranslation();
  const requestChange = useDialogHistory(open, onOpenChange, history);
  const drag = useDragDismiss(() => requestChange(false));
  return (
    <D.Root open={open} onOpenChange={requestChange}>
      <D.Portal>
        <D.Overlay className="overlay-fade fixed inset-0 z-[70] bg-[var(--scrim)] backdrop-blur-[4px]" />
        <D.Content
          className={cn(
            'glass fixed inset-x-0 bottom-0 z-[71] flex max-h-[92dvh] flex-col rounded-t-[var(--radius-xl)] border border-b-0 border-line-strong shadow-elev-4 focus:outline-none',
            className,
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex-none touch-none px-5 pt-2 md:touch-auto md:px-6 md:pt-5" {...drag}>
            <span
              aria-hidden
              className="mx-auto mb-2 block h-1.5 w-10 rounded-full bg-line-strong md:hidden"
            />
            <div className="flex items-start justify-between gap-4">
              <D.Title className="pt-1.5 text-title font-semibold">{title}</D.Title>
              <D.Close
                className="-mr-2 grid size-11 flex-none place-items-center rounded-full text-fg-2 transition-colors hover:bg-hover hover:text-fg"
                aria-label={t('common.close')}
              >
                <X className="size-5" aria-hidden />
              </D.Close>
            </div>
            {description && <D.Description className="mt-1 text-meta text-fg-2">{description}</D.Description>}
          </div>
          <div
            className={cn(
              'grid min-h-0 flex-1 content-start gap-4 overflow-y-auto overscroll-contain px-5 pt-3 md:px-6',
              footer ? 'pb-4' : 'pb-[calc(20px+env(safe-area-inset-bottom,0px))] md:pb-6',
            )}
          >
            {children}
          </div>
          {footer && (
            <div className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-line px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] md:px-6 md:pb-4">
              {footer}
            </div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
