import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Class merging that knows our theme: without the type scale, `text-meta` and `text-fg-2` would
 * look like two colours and the size would be dropped.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['caption', 'meta', 'body', 'lead', 'title', 'headline', 'display', 'hero'],
      shadow: ['elev-0', 'elev-1', 'elev-2', 'elev-3', 'elev-4'],
      ease: ['snappy', 'smooth', 'bouncy', 'spring'],
    },
  },
});

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
