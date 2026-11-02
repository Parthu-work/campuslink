import { useTranslation } from '../../i18n/react';
import { PersonAvatar } from './person-avatar';

/**
 * Overlapping avatars with a "+N" for the rest (RSVPs, alumni at a company). Decorative faces; the
 * label says who and how many, so screen readers hear one sentence.
 */
export function AvatarStack({
  people,
  label,
  max = 4,
  size = 28,
}: {
  people: readonly { name: string; fileId?: string | null }[];
  /** For example "Ananya and 6 others are going". */
  label: string;
  max?: number;
  size?: number;
}) {
  const { t } = useTranslation();
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span role="img" aria-label={label} className="flex items-center">
      {shown.map((p, i) => (
        <span key={`${p.name}-${i}`} className="-ml-2 rounded-full ring-2 ring-surface-1 first:ml-0">
          <PersonAvatar name={p.name} fileId={p.fileId ?? null} size={size} />
        </span>
      ))}
      {rest > 0 && (
        <span
          aria-hidden
          className="-ml-2 grid place-items-center rounded-full bg-surface-3 text-caption font-semibold text-fg-2 ring-2 ring-surface-1"
          style={{ width: size, height: size }}
        >
          {t('common.plusN', { n: rest })}
        </span>
      )}
    </span>
  );
}
