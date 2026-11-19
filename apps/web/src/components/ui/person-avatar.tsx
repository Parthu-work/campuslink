import { Avatar } from './misc';
import { useFileUrl } from '../../lib/files';
import { useNearViewport } from '../../lib/use-near-viewport';

/**
 * Profile photo when one exists, initials otherwise. Decorative: the name is always shown beside it.
 * Prompt 3, U10: the photo is the small copy (160 px, 320 for a large avatar), fetched only when the
 * avatar is about to be seen; the initials hold the same box meanwhile, so nothing moves.
 */
export function PersonAvatar({
  name,
  fileId,
  size = 44,
  verified = false,
  transitionName,
}: {
  name: string;
  fileId?: string | null;
  size?: number;
  verified?: boolean;
  /** Morphs into the same avatar on the next screen (a view transition; unique per person). */
  transitionName?: string;
}) {
  const [ref, near] = useNearViewport<HTMLSpanElement>();
  const url = useFileUrl(fileId, size <= 56 ? 160 : 320, { sized: true, enabled: near });
  return (
    <span
      ref={ref}
      className="relative flex-none"
      style={{ width: size, height: size, ...(transitionName ? { viewTransitionName: transitionName } : {}) }}
      aria-hidden
    >
      {url ? (
        <>
          <img
            src={url}
            alt=""
            width={size}
            height={size}
            decoding="async"
            className="size-full rounded-full object-cover"
          />
          {verified && (
            <span className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full border-2 border-surface-1 bg-brand">
              <svg viewBox="0 0 24 24" className="size-2.5 fill-none stroke-on-brand stroke-[3.5]">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            </span>
          )}
        </>
      ) : (
        <Avatar name={name} size={size} verified={verified} />
      )}
    </span>
  );
}
