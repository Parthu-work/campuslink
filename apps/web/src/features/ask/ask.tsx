import { useLocation, useSearchParams } from 'react-router';
import { History, MessageSquarePlus } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Sheet } from '../../components/ui/dialog';
import { EmptyState } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { Segmented } from '../../components/ui/tab-nav';
import { useCan } from '../../lib/me';
import { useFeature } from '../../lib/tenant-context';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { CareerPanel } from '../copilot/career-panel';
import { ChatPanel } from '../study/chat/chat-panel';
import { AskHistory, type AskScope } from './history';

/**
 * Ask (prompt 3, U8; X8): one assistant with two scopes. Study is the study assistant
 * (`ChatService`, a subject's material); Career is the Career Copilot (`AiTasksService`, the
 * college's records). Their servers, rules and limits stay apart; the way in, the chat and the
 * history are one. `/ask?scope=career&s=<conversation>`; a question from search arrives in the
 * router's state and waits in the composer.
 */
export function AskPage() {
  const { t } = useTranslation();
  const readsStudy = useCan('study:read');
  const studyOn = useFeature('study');
  const usesCopilot = useCan('copilot:use');
  const placementsOn = useFeature('placements');
  const scopes: AskScope[] = [
    ...(readsStudy && studyOn ? (['study'] as const) : []),
    ...(usesCopilot && placementsOn ? (['career'] as const) : []),
  ];
  const [params, setParams] = useSearchParams();
  const asked = params.get('scope') as AskScope | null;
  const scope: AskScope | undefined = asked && scopes.includes(asked) ? asked : scopes[0];
  const session = params.get('s');
  const location = useLocation();
  const state = location.state as { ask?: unknown; fresh?: unknown } | null;
  const initialInput = typeof state?.ask === 'string' ? state.ask.slice(0, 600) : '';
  const history = useUrlOverlay('history');
  // A fresh panel comes with the navigation that asks for it (New, the other scope, another
  // conversation, a question from search), so the panel and the address change together; our own
  // new conversation keeps the state, and so the panel.
  const panel = `${scope}-${typeof state?.fresh === 'string' || typeof state?.fresh === 'number' ? state.fresh : ''}`;
  const start = (next: Record<string, string>) => setParams(next, { state: { fresh: Date.now() } });
  if (!scope) return <EmptyState title={t('nav.assistant')}>{t('ask.none')}</EmptyState>;
  const onSession = (id: string) => setParams({ scope, s: id }, { replace: true, state: location.state });
  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="hidden content-start gap-3 lg:grid" aria-labelledby="ask-history">
        <h2 id="ask-history" className="text-headline font-semibold">
          {t('ask.history')}
        </h2>
        <AskHistory scopes={scopes} current={session} />
      </aside>
      <section className="grid min-w-0 content-start gap-3">
        <PageHeader
          title={t('nav.assistant')}
          actions={
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                className="lg:hidden"
                aria-label={t('ask.historyButton')}
                onClick={() => history.open('1')}
              >
                <History className="size-4" aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="lg:hidden"
                aria-label={t('ask.newChat')}
                onClick={() => start({ scope })}
              >
                <MessageSquarePlus className="size-4" aria-hidden />
              </Button>
              <Button variant="outline" size="sm" className="max-lg:hidden" onClick={() => start({ scope })}>
                <MessageSquarePlus className="size-4" aria-hidden /> {t('ask.newChat')}
              </Button>
            </div>
          }
        />
        {scopes.length > 1 && (
          <Segmented<AskScope>
            label={t('ask.scopeLabel')}
            value={scope}
            onChange={(v) => start({ scope: v })}
            options={scopes.map((s) => [s, t(`ask.scope.${s}`)] as const)}
          />
        )}
        <div className="flex h-[calc(100dvh-24rem)] min-h-[20rem] flex-col lg:h-[calc(100dvh-14rem)] lg:min-h-[26rem]">
          {scope === 'study' ? (
            <ChatPanel key={panel} sessionId={session} initialInput={initialInput} onSession={onSession} />
          ) : (
            <CareerPanel key={panel} sessionId={session} initialInput={initialInput} onSession={onSession} />
          )}
        </div>
      </section>
      <Sheet
        open={history.value === '1'}
        onOpenChange={(o) => !o && history.close()}
        title={t('ask.history')}
        history={false}
      >
        {/* Opening a conversation replaces the sheet's history entry, so Back does not reopen it. */}
        <AskHistory scopes={scopes} current={session} replace />
      </Sheet>
    </div>
  );
}
