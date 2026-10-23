import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Sheet } from '../../../components/ui/dialog';
import { Skeleton } from '../../../components/ui/misc';
import type { AskContext } from '../../../lib/chat';
import { useUrlOverlay } from '../../../lib/use-url-overlay';

// The chat itself (and its answer renderer) loads when the sheet opens.
const ChatPanel = lazy(() => import('./chat-panel').then((m) => ({ default: m.ChatPanel })));

/**
 * The study assistant's floating launcher on subject and material pages: opens the chat in a
 * sheet scoped to the subject (`?ask=1`, so Back closes it). Pages that know what the member is
 * looking at pass it as `context` ("Ask about this page").
 */
export function ChatLauncher({
  subjectId,
  context = null,
}: {
  subjectId: string;
  context?: AskContext | null;
}) {
  const { t } = useTranslation();
  const sheet = useUrlOverlay('ask');
  const open = sheet.value !== null;
  return (
    <>
      <Button
        variant="primary"
        size="lg"
        onClick={() => sheet.open('1')}
        className="fixed end-4 bottom-[calc(88px+env(safe-area-inset-bottom,0px))] z-30 shadow-elev-3 lg:end-8 lg:bottom-8"
        aria-haspopup="dialog"
      >
        <Sparkles className="size-5" aria-hidden /> {t('study.chat.launcher')}
      </Button>
      <Sheet
        open={open}
        onOpenChange={(o) => !o && sheet.close()}
        title={t('study.chat.title')}
        history={false}
      >
        <div className="flex h-[min(78dvh,760px)] flex-col">
          {open && (
            <Suspense fallback={<Skeleton className="h-full" />}>
              <ChatPanel subjectId={subjectId} context={context} />
            </Suspense>
          )}
        </div>
      </Sheet>
    </>
  );
}
