import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from '../../i18n/react';
import { labelEvery, niceTicks } from '../../lib/chart';
import { useWidth } from '../../lib/use-width';
import { formatCompact, formatNumber } from '../../lib/numbers';
import { cn } from '../../lib/cn';
import { Table, THead, Td, TdNum, Th } from './table';

export interface ColumnPoint {
  key: string;
  /** Axis and table label. */
  label: string;
  value: number;
  /** Extra lines for the tooltip and the table (e.g. a breakdown). */
  detail?: ReactNode;
  /** Shown instead of the value, with no column drawn: "<5" for a suppressed count. */
  display?: string;
}

/**
 * One series over time, in the brand hue: thin columns (at most 24px) with a 4px rounded top on a
 * hairline baseline, round axis ticks, and a tooltip on hover and on keyboard focus (each column
 * is a stop in the tab order). Every value is also in the table view, so nothing depends on the
 * tooltip. The title names the series, so there is no legend. The drawing is laid out at its
 * rendered width (one unit is one CSS pixel), so axis labels stay 12 px on a phone.
 */
export function ColumnChart({
  title,
  description,
  points,
  format = formatCompact,
  valueHeader,
  labelHeader,
  className,
}: {
  title: string;
  description?: ReactNode;
  points: ColumnPoint[];
  format?: (n: number) => string;
  /** Table column headings. */
  valueHeader: string;
  labelHeader: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const { ref, width: W } = useWidth<HTMLDivElement>(640);
  const H = 200;
  const pad = { l: 44, r: 8, t: 12, b: 28 };
  const ticks = niceTicks(Math.max(0, ...points.map((p) => p.value)));
  const top = ticks.at(-1) || 1;
  const plotH = H - pad.t - pad.b;
  const slot = (W - pad.l - pad.r) / Math.max(1, points.length);
  const bw = Math.max(2, Math.min(24, slot - 2));
  const showLabel = labelEvery(points.length, Math.max(2, Math.floor((W - pad.l - pad.r) / 56)));
  const y = (v: number) => pad.t + plotH - (plotH * v) / top;
  const cur = active !== null ? points[active] : undefined;

  return (
    <figure className={cn('grid gap-2', className)} aria-labelledby={`${id}-t`}>
      <figcaption className="grid gap-0.5">
        <span id={`${id}-t`} className="font-semibold">
          {title}
        </span>
        {description && <span className="text-meta text-fg-2">{description}</span>}
      </figcaption>
      <div ref={ref} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          className="block"
          role="group"
          aria-label={title}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
              <text
                x={pad.l - 6}
                y={y(v) + 4}
                textAnchor="end"
                className="fill-[var(--fg-3)] text-caption tabular-nums"
              >
                {format(v)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const h = p.display === undefined && p.value > 0 ? Math.max(2, (plotH * p.value) / top) : 0;
            const x = pad.l + i * slot + (slot - bw) / 2;
            const r = Math.min(4, h, bw / 2);
            const base = pad.t + plotH;
            return (
              <g
                key={p.key}
                tabIndex={0}
                role="img"
                aria-label={`${p.label}: ${p.display ?? format(p.value)}`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="outline-none [&:focus-visible>rect:first-child]:stroke-[var(--focus-ring)]"
              >
                {/* The hit target is the whole slot, taller and wider than the column. */}
                <rect
                  x={pad.l + i * slot}
                  y={pad.t}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  strokeWidth={2}
                />
                {h > 0 && (
                  <path
                    d={`M ${x} ${base} V ${base - h + r} Q ${x} ${base - h} ${x + r} ${base - h} H ${x + bw - r} Q ${x + bw} ${base - h} ${x + bw} ${base - h + r} V ${base} Z`}
                    fill="var(--brand)"
                    className="transition-opacity duration-[var(--dur-fast)]"
                    opacity={active === null || active === i ? 1 : 0.55}
                  />
                )}
                {p.display !== undefined && (
                  <text
                    x={pad.l + i * slot + slot / 2}
                    y={base - 6}
                    textAnchor="middle"
                    className="fill-[var(--fg-3)] text-caption"
                  >
                    {p.display}
                  </text>
                )}
                {showLabel(i) && (
                  <text
                    x={pad.l + i * slot + slot / 2}
                    y={H - 8}
                    textAnchor="middle"
                    className="fill-[var(--fg-3)] text-caption"
                  >
                    {p.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {cur && active !== null && (
          <div
            className="pointer-events-none absolute top-0 z-[1] grid max-w-56 gap-0.5 rounded-[var(--radius-sm)] border border-line bg-surface-1 px-3 py-2 text-caption shadow-elev-2"
            style={
              active > points.length / 2
                ? { right: `${((points.length - active - 1) / points.length) * 100}%` }
                : { left: `${(active / points.length) * 100}%` }
            }
            role="status"
          >
            <span className="text-meta font-semibold tabular-nums">{cur.display ?? format(cur.value)}</span>
            <span className="text-fg-2">{cur.label}</span>
            {cur.detail && <span className="text-fg-2">{cur.detail}</span>}
          </div>
        )}
      </div>
      <details className="text-meta">
        <summary className="cursor-pointer py-3 text-fg-2">{t('common.showTable')}</summary>
        <Table label={title} className="mt-2">
          <THead>
            <tr>
              <Th>{labelHeader}</Th>
              <Th className="text-right">{valueHeader}</Th>
            </tr>
          </THead>
          <tbody>
            {points.map((p) => (
              <tr key={p.key}>
                <Td>
                  {p.label}
                  {p.detail && <span className="block text-caption text-fg-3">{p.detail}</span>}
                </Td>
                <TdNum>{p.display ?? formatNumber(p.value)}</TdNum>
              </tr>
            ))}
          </tbody>
        </Table>
      </details>
    </figure>
  );
}
