import { useTranslation } from 'react-i18next';
import { Film, ImagePlus } from 'lucide-react';
import { POST_KINDS, type PostKind } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { lazyPart } from '../../lib/lazy-part';
import { useMe } from '../../lib/me';
import { useUrlOverlay } from '../../lib/use-url-overlay';

const ComposerForm = lazyPart(() => import('./composer-form').then((m) => m.ComposerForm));

const COMPOSE_KINDS: readonly PostKind[] = POST_KINDS;

/** "Share something useful" entry point; the form remounts per open (fresh idempotency key). */
export function Composer() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  // The composer's open state lives in the URL (?compose=text), so Back closes it and the Create
  // sheet can open it from anywhere.
  const overlay = useUrlOverlay('compose');
  const open = COMPOSE_KINDS.find((k) => k === overlay.value) ?? null;
  const setOpen = (kind: PostKind | null) => (kind ? overlay.open(kind) : overlay.close());
  return (
    <>
      <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-line bg-surface-1 p-3">
        <PersonAvatar name={me?.name ?? '?'} fileId={null} size={36} />
        <button
          type="button"
          onClick={() => setOpen('text')}
          className="min-h-11 min-w-0 flex-1 rounded-full border border-line-strong px-4 text-left text-meta text-fg-3 hover:border-brand"
        >
          {t('feed.composerPrompt')}
        </button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('feed.kinds.photo')}
          onClick={() => setOpen('photo')}
        >
          <ImagePlus className="size-5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('feed.kinds.reel')}
          onClick={() => setOpen('reel')}
          className="hidden sm:inline-flex"
        >
          <Film className="size-5" aria-hidden />
        </Button>
      </div>
      <Dialog
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={t('feed.newPost')}
        history={false}
      >
        {open && (
          <ComposerForm
            initialKind={open}
            onDone={() => setOpen(null)}
            fallback={<Skeleton className="h-72" />}
          />
        )}
      </Dialog>
    </>
  );
}
