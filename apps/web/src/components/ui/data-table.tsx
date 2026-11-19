import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Table, Td, Th, THead } from './table';

export interface Column<R> {
  key: string;
  header: string;
  cell: (row: R) => ReactNode;
  /** The column sorts by this value when its header is pressed. */
  sort?: (row: R) => string | number;
  numeric?: boolean;
  /** Shown from 640 px only: phones keep the columns that decide. */
  wide?: boolean;
}

type Sort = { key: string; dir: 'asc' | 'desc' };

/**
 * One table pattern for staff lists (ADR 0015, prompt 3 U9): compact rows under a sticky header,
 * sort by any column that allows it (`aria-sort`), select rows for a bulk action that sits in a
 * sticky bar while anything is selected, and a row that opens its detail (the first column's
 * button, so the keyboard reaches it; a click anywhere else on the row does the same). Text comes
 * from the screen, so the strings live with the screen's own pack.
 */
export function DataTable<R>({
  label,
  rows,
  rowKey,
  columns,
  onOpen,
  openLabel,
  selection,
  bar,
  initialSort,
  className,
}: {
  label: string;
  rows: R[];
  rowKey: (row: R) => string;
  columns: Column<R>[];
  /** The row's detail (a side panel). */
  onOpen?: (row: R) => void;
  /** The first column's button label for screen readers ("Open Ananya K's request"). */
  openLabel?: (row: R) => string;
  selection?: {
    selected: readonly string[];
    onChange: (ids: string[]) => void;
    /** "Select Ananya K". */
    rowLabel: (row: R) => string;
    /** "Select all". */
    allLabel: string;
  };
  /** The sticky bar while rows are selected: the count and the bulk actions. */
  bar?: ReactNode;
  initialSort?: Sort;
  className?: string;
}) {
  const [sort, setSort] = useState<Sort | null>(initialSort ?? null);
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!col?.sort || !sort) return rows;
    const by = col.sort;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = by(a);
      const y = by(b);
      return (
        (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir
      );
    });
  }, [rows, columns, sort]);
  const selected = new Set(selection?.selected ?? []);
  const allOn = !!selection && rows.length > 0 && rows.every((r) => selected.has(rowKey(r)));
  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, row: R) => {
    if (!onOpen) return;
    // A click on a control in the row (a checkbox, a button, a link) is that control's.
    if ((e.target as HTMLElement).closest('button, a, input, label, select, textarea')) return;
    onOpen(row);
  };
  const wideCell = (c: Column<R>) => (c.wide ? 'max-sm:hidden' : '');
  return (
    <div data-density="compact" className={cn('grid min-w-0 gap-3', className)}>
      <Table label={label}>
        <THead>
          <tr>
            {selection && (
              <Th className="w-12">
                <input
                  type="checkbox"
                  aria-label={selection.allLabel}
                  checked={allOn}
                  onChange={(e) => selection.onChange(e.target.checked ? rows.map(rowKey) : [])}
                  className="size-5 accent-[var(--brand)]"
                />
              </Th>
            )}
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <Th
                  key={c.key}
                  aria-sort={
                    c.sort ? (active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined
                  }
                  className={cn(c.numeric && 'text-right', wideCell(c))}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className="inline-flex min-h-11 items-center gap-1 font-semibold hover:text-fg"
                    >
                      {c.header}
                      {active ? (
                        sort.dir === 'asc' ? (
                          <ArrowUp className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3.5" aria-hidden />
                        )
                      ) : (
                        <ArrowUpDown className="size-3.5 text-fg-3" aria-hidden />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </Th>
              );
            })}
          </tr>
        </THead>
        <tbody>
          {sorted.map((r) => {
            const id = rowKey(r);
            const on = selected.has(id);
            return (
              <tr
                key={id}
                onClick={(e) => onRowClick(e, r)}
                aria-selected={selection ? on : undefined}
                className={cn(onOpen && 'cursor-pointer hover:bg-hover', on && 'bg-brand-surface')}
              >
                {selection && (
                  <Td className="w-12">
                    <input
                      type="checkbox"
                      aria-label={selection.rowLabel(r)}
                      checked={on}
                      onChange={(e) =>
                        selection.onChange(
                          e.target.checked
                            ? [...new Set([...selected, id])]
                            : [...selected].filter((x) => x !== id),
                        )
                      }
                      className="size-5 accent-[var(--brand)]"
                    />
                  </Td>
                )}
                {columns.map((c, i) => (
                  <Td key={c.key} className={cn(c.numeric && 'text-right', wideCell(c))}>
                    {i === 0 && onOpen ? (
                      <button
                        type="button"
                        onClick={() => onOpen(r)}
                        aria-label={openLabel?.(r)}
                        className="grid min-h-11 w-full content-center text-left hover:underline"
                      >
                        {c.cell(r)}
                      </button>
                    ) : (
                      c.cell(r)
                    )}
                  </Td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </Table>
      {bar && selected.size > 0 && (
        <div className="sticky bottom-[calc(84px+env(safe-area-inset-bottom,0px))] z-20 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-line-strong bg-surface-1 p-3 shadow-elev-3 lg:bottom-4">
          {bar}
        </div>
      )}
    </div>
  );
}
