import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Dialog } from '../../components/ui/dialog';
import { Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { stories } from '../../lib/queries';
import { useCan } from '../../lib/me';
import { useTenant } from '../../lib/tenant-context';
import { groupStories, seenStories, type StoryGroup } from '../../lib/stories';
import { cn } from '../../lib/cn';
import { lazyPart } from '../../lib/lazy-part';

const StoryViewer = lazyPart(() => import('./story-viewer').then((m) => m.StoryViewer));
const StoryComposer = lazyPart(() => import('./story-composer').then((m) => m.StoryComposer));

export function StoriesRow() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const canPost = useCan('feed:post');
  const enabled = tenant.features?.stories !== false;
  const q = useQuery({ ...stories(), enabled });
  // The rings are frozen while the viewer is open, so a refetch cannot reorder what is playing.
  const [viewing, setViewing] = useState<{ groups: StoryGroup[]; start: number } | null>(null);
  const [composing, setComposing] = useState(false);
  if (!enabled) return null;
  const groups = groupStories(q.data ?? [], seenStories());
  if (!q.isLoading && !groups.length && !canPost) return null;
  return (
    <section aria-label={t('stories.title')}>
      <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto overscroll-x-contain px-1 pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>li]:snap-start">
        {canPost && (
          <li className="flex-none">
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="pressable grid w-[72px] justify-items-center gap-1.5 text-caption text-fg-2"
            >
              <span className="grid size-[68px] place-items-center rounded-full border-2 border-dashed border-line-strong text-brand-ink">
                <Plus className="size-6" aria-hidden />
              </span>
              {t('stories.add')}
            </button>
          </li>
        )}
        {q.isLoading &&
          [0, 1, 2].map((k) => (
            <li key={k} className="flex-none">
              <Skeleton className="size-[68px] rounded-full" />
            </li>
          ))}
        {groups.map((gr, idx) => (
          <li key={gr.authorId} className="flex-none">
            <button
              type="button"
              onClick={() => setViewing({ groups, start: idx })}
              className="pressable grid w-[72px] justify-items-center gap-1.5 text-caption"
              aria-label={t(gr.seen ? 'stories.openSeen' : 'stories.open', {
                name: gr.mine ? t('stories.yours') : gr.author.name,
                count: gr.stories.length,
              })}
            >
              {/* New stories ring in aurora; watched ones go quiet (seen vs unseen, §8.3). */}
              <span
                className={cn(
                  'grid size-[68px] place-items-center rounded-full p-[3px]',
                  gr.seen ? 'bg-line-strong' : 'aurora-ring',
                )}
              >
                <span className="grid place-items-center rounded-full bg-bg p-[2px]">
                  <PersonAvatar name={gr.author.name || '?'} fileId={gr.author.avatarFileId} size={58} />
                </span>
              </span>
              <span className={cn('w-full truncate text-center', gr.seen ? 'text-fg-3' : 'text-fg')}>
                {gr.mine ? t('stories.yours') : gr.author.name.split(' ')[0]}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {viewing && (
        <StoryViewer groups={viewing.groups} start={viewing.start} onClose={() => setViewing(null)} />
      )}
      <Dialog
        open={composing}
        onOpenChange={setComposing}
        title={t('stories.new')}
        description={t('stories.newBody')}
      >
        {composing && (
          <StoryComposer onDone={() => setComposing(false)} fallback={<Skeleton className="h-72" />} />
        )}
      </Dialog>
    </section>
  );
}
