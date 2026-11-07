import { useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { Sheet } from './dialog';
import { Button } from './button';
import { cn } from '../../lib/cn';
import { useMedia } from '../../lib/use-media';

/**
 * Filters, search, view switch and sort above a list (ADR 0015). On wide screens everything sits
 * in one row; on phones the search and view switch stay and the filters move into a sheet behind
 * a "Filters · n" button, so the list starts near the top of the screen.
 */
export function Toolbar({
  search,
  filters,
  activeFilters = 0,
  onClearFilters,
  end,
  className,
}: {
  /** A search field (an Input with a label). */
  search?: ReactNode;
  /** Filter controls (chips, selects); in a sheet on phones. */
  filters?: ReactNode;
  /** How many filters are on (the button's count; 0 hides it). */
  activeFilters?: number;
  onClearFilters?: () => void;
  /** View switch or sort, always visible. */
  end?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wide = useMedia('(min-width: 768px)');
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-2', className)} role="group">
      {search && <div className="min-w-0 flex-[1_1_14rem]">{search}</div>}
      {filters && wide && <div className="flex min-w-0 flex-wrap items-center gap-2">{filters}</div>}
      {filters && !wide && (
        <>
          <Button variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
            <SlidersHorizontal aria-hidden />
            {activeFilters > 0 ? t('ui.filtersN', { count: activeFilters }) : t('ui.filters')}
          </Button>
          <Sheet
            open={open}
            onOpenChange={setOpen}
            title={t('ui.filters')}
            footer={
              <div className="flex gap-2">
                {onClearFilters && activeFilters > 0 && (
                  <Button variant="tertiary" onClick={onClearFilters}>
                    {t('ui.clearFilters')}
                  </Button>
                )}
                <Button variant="primary" className="flex-1" onClick={() => setOpen(false)}>
                  {t('ui.showResults')}
                </Button>
              </div>
            }
          >
            <div className="flex flex-wrap gap-2 pb-2">{filters}</div>
          </Sheet>
        </>
      )}
      {end && <div className="ml-auto flex flex-none items-center gap-2">{end}</div>}
    </div>
  );
}
