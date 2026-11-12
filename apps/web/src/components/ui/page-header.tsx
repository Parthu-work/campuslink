import { useRef, useState, type ReactNode } from 'react';
import { Info, MoreHorizontal } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import type { OverflowItem } from './overflow-menu';
import { cn } from '../../lib/cn';
import { lazyPart } from '../../lib/lazy-part';

// Both sheets load on first tap (Radix Dialog; most visits never open them).
const Sheets = lazyPart(() => import('./overflow-sheet').then((m) => m.HeaderSheets));
const Compact = lazyPart(() => import('./compact-bar').then((m) => m.CompactBar));

/**
 * The top of a screen (ADR 0015): one h1 (focused after navigation), an optional one-line
 * subtitle, the screen's one primary action and an overflow of the rest. No explanatory paragraph
 * above the content (A6): `about` (or the older `intro`) goes behind an "About this" button that
 * opens a sheet. On phones, once the title scrolls away and the app bar hides, a compact bar with
 * the title and the primary action takes its place.
 *
 * `icon` is accepted for older screens and not drawn (ADR 0015: icons only where they add
 * meaning). `size="display"` is for the few hero screens.
 */
export function PageHeader({
  title,
  subtitle,
  primary,
  overflow,
  about,
  intro,
  eyebrow,
  actions,
  back,
  size = 'title',
  as: Root = 'header',
  level = 1,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** The screen's one primary action (a Button or link styled as one). */
  primary?: ReactNode;
  /** Secondary actions, behind "More actions". */
  overflow?: OverflowItem[];
  /** What this screen is for: shown in a sheet, never above the content. */
  about?: ReactNode;
  /** @deprecated Older name for `about`. */
  intro?: ReactNode;
  eyebrow?: ReactNode;
  /** Extra controls beside the primary action (a toggle, a filter): keep them few. */
  actions?: ReactNode;
  /** A BackLink above the title on screens that are not a space's root. */
  back?: ReactNode;
  /** @deprecated Not drawn (ADR 0015). */
  icon?: ReactNode;
  size?: 'title' | 'display' | 'headline';
  /** `div` inside a detail page's own `<header>` (headers don't nest). */
  as?: 'header' | 'div';
  /** 2 only where the header is a specimen inside another page (the style guide). */
  level?: 1 | 2;
  className?: string;
}) {
  const { t } = useTranslation();
  const Heading = level === 1 ? 'h1' : 'h2';
  const explain = about ?? intro;
  const [sheet, setSheet] = useState<'about' | 'more' | null>(null);
  const [loaded, setLoaded] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const open = (which: 'about' | 'more') => {
    setLoaded(true);
    setSheet(which);
  };
  const icon = 'grid size-11 place-items-center rounded-[var(--radius-md)] text-fg-2 hover:bg-hover';
  return (
    <Root className={cn('grid gap-2', className)}>
      {back}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="grid min-w-0 flex-[1_1_16rem] gap-1">
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <Heading
            ref={heading}
            className={cn(
              'min-w-0 font-bold text-pretty break-words',
              size === 'display' ? 'text-display' : size === 'headline' ? 'text-headline' : 'text-title',
            )}
          >
            {title}
          </Heading>
          {subtitle && <p className="text-callout text-fg-2">{subtitle}</p>}
        </div>
        {(primary || actions || overflow?.length || explain) && (
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {explain && (
              <button
                type="button"
                onClick={() => open('about')}
                className={icon}
                aria-label={t('ui.aboutThis')}
                aria-haspopup="dialog"
              >
                <Info aria-hidden />
              </button>
            )}
            {!!overflow?.length && (
              <button
                type="button"
                onClick={() => open('more')}
                className={icon}
                aria-label={t('ui.moreActions')}
                aria-haspopup="dialog"
              >
                <MoreHorizontal aria-hidden />
              </button>
            )}
            {primary}
          </div>
        )}
      </div>
      {loaded && (
        <Sheets which={sheet} onClose={() => setSheet(null)} about={explain} items={overflow ?? []} />
      )}
      {level === 1 && <Compact heading={heading} title={title} primary={primary} />}
    </Root>
  );
}
