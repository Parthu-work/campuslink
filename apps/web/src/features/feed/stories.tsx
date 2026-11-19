import { useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { stories } from '../../lib/queries';
import { useCan } from '../../lib/me';
import { useTenant } from '../../lib/tenant-context';
import { groupStories, seenStories, type StoryGroup } from '../../lib/stories';
import { cn } from '../../lib/cn';
import { lazyPart } from '../../lib/lazy-part';
import { firstName } from '../../lib/names';

const StoryViewer = lazyPart(() => import('./story-viewer').then((m) => m.StoryViewer));
const StoryComposer = lazyPart(() => import('./story-composer').then((m) => m.StoryComposer));

/** The story composer in a dialog: from the row, or from "New story" where the row is hidden. */
function ComposerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('stories.new')}
      description={t('stories.newBody')}
    >
      {open && <StoryComposer onDone={() => onOpenChange(false)} fallback={<Skeleton className="h-72" />} />}
    </Dialog>
  );
}

/**
 * "New story" for members who post, where the row is hidden (prompt 3, U5: Home shows the row only
 * with three or more active stories), so the first stories can still be added.
 */
export function NewStoryButton() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const canPost = useCan('feed:post');
  const [composing, setComposing] = useState(false);
  if (tenant.features?.stories === false || !canPost) return null;
  return (
    <>
      <Button variant="tertiary" size="sm" onClick={() => setComposing(true)}>
        <Plus aria-hidden /> {t('stories.new')}
      </Button>
      <ComposerDialog open={composing} onOpenChange={setComposing} />
    </>
  );
}

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
              {/* "Your story" is the member's own ring once they have one; then this one adds another. */}
              {groups.some((g) => g.mine) ? t('stories.addAnother') : t('stories.add')}
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
              <span
                className={cn(
                  'w-full text-center leading-tight [overflow-wrap:anywhere]',
                  gr.seen ? 'text-fg-3' : 'text-fg',
                )}
              >
                {gr.mine ? t('stories.yours') : firstName(gr.author.name)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {viewing && (
        <StoryViewer groups={viewing.groups} start={viewing.start} onClose={() => setViewing(null)} />
      )}
      <ComposerDialog open={composing} onOpenChange={setComposing} />
    </section>
  );
}
