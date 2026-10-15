import { Avatar } from './misc';
import { useFileUrl } from '../../lib/files';

/** Profile photo when one exists, initials otherwise. Decorative: the name is always shown beside it. */
export function PersonAvatar({
  name,
  fileId,
  size = 44,
  verified = false,
}: {
  name: string;
  fileId?: string | null;
  size?: number;
  verified?: boolean;
}) {
  const url = useFileUrl(fileId);
  if (!url) return <Avatar name={name} size={size} verified={verified} />;
  return (
    <span className="relative flex-none" style={{ width: size, height: size }} aria-hidden>
      <img src={url} alt="" width={size} height={size} className="size-full rounded-full object-cover" />
      {verified && (
        <span className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full border-2 border-surface-1 bg-brand">
          <svg viewBox="0 0 24 24" className="size-2.5 fill-none stroke-on-brand stroke-[3.5]">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </span>
      )}
    </span>
  );
}
