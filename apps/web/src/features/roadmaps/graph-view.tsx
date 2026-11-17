import { useMemo, useState } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import type { RoadmapView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Card } from '../../components/ui/misc';
import { NODE_H, NODE_W, layoutGraph } from '../../lib/roadmaps';

/**
 * The path as a map of steps and how they connect: an option for those who want the whole graph
 * (the journey is the default view). Loaded only when chosen. Prompt 3, U3b rebuilds it (fit to
 * the screen, wrapping labels, gesture zoom, the current step centred).
 */
export function GraphView({ roadmap, onOpen }: { roadmap: RoadmapView; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const { placed, width, height } = useMemo(
    () => layoutGraph(roadmap.content.nodes),
    [roadmap.content.nodes],
  );
  const done = new Set(roadmap.myProgress?.done ?? []);
  const pos = new Map(placed.map((p) => [p.node.id, p]));
  const pad = 24;
  const w = width + pad * 2;
  const h = height + pad * 2;
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex justify-end gap-1 border-b border-line p-1.5">
        <button
          type="button"
          aria-label={t('roadmaps.zoomOut')}
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          className="grid size-9 place-items-center rounded-full hover:bg-surface-2"
        >
          <Minus className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t('roadmaps.zoomFit')}
          onClick={() => setZoom(1)}
          className="grid size-9 place-items-center rounded-full hover:bg-surface-2"
        >
          <Scan className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t('roadmaps.zoomIn')}
          onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
          className="grid size-9 place-items-center rounded-full hover:bg-surface-2"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
      {/* Native scrolling pans (touch, trackpad, keyboard); buttons zoom. */}
      <div
        className="max-h-[70vh] overflow-auto overscroll-contain"
        tabIndex={0}
        aria-label={t('roadmaps.graphLabel')}
        role="region"
      >
        <svg
          width={w * zoom}
          height={h * zoom}
          viewBox={`${-pad} ${-pad} ${w} ${h}`}
          className="block"
          role="list"
          aria-label={t('roadmaps.graphLabel')}
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line-strong)" />
            </marker>
          </defs>
          {placed.flatMap((p) =>
            p.node.prerequisites.flatMap((pre) => {
              const a = pos.get(pre);
              if (!a) return [];
              const x1 = a.x + NODE_W;
              const y1 = a.y + NODE_H / 2;
              const x2 = p.x;
              const y2 = p.y + NODE_H / 2;
              const mx = (x1 + x2) / 2;
              return [
                <path
                  key={`${pre}-${p.node.id}`}
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2 - 4} ${y2}`}
                  fill="none"
                  stroke={done.has(pre) ? 'var(--success)' : 'var(--line-strong)'}
                  strokeWidth={2}
                  markerEnd="url(#arrow)"
                  aria-hidden
                />,
              ];
            }),
          )}
          {placed.map((p) => {
            const isDone = done.has(p.node.id);
            return (
              <g key={p.node.id} role="listitem" transform={`translate(${p.x} ${p.y})`}>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`${p.node.title}, ${t(`roadmaps.kind.${p.node.kind}`)}${isDone ? `, ${t('roadmaps.done')}` : ''}${p.node.needsReview ? `, ${t('roadmaps.needsReview')}` : ''}`}
                  onClick={() => onOpen(p.node.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen(p.node.id);
                    }
                  }}
                  className="group cursor-pointer outline-none"
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={14}
                    fill={
                      isDone ? 'color-mix(in srgb, var(--success) 18%, var(--surface-1))' : 'var(--surface-1)'
                    }
                    stroke={
                      isDone
                        ? 'var(--success)'
                        : p.node.kind === 'project'
                          ? 'var(--accent)'
                          : 'var(--line-strong)'
                    }
                    strokeWidth={p.node.kind === 'project' || isDone ? 2.5 : 1.5}
                    strokeDasharray={p.node.needsReview ? '6 4' : undefined}
                    className="transition-[stroke] group-hover:stroke-[var(--brand)]"
                  />
                  <rect
                    x={-4}
                    y={-4}
                    width={NODE_W + 8}
                    height={NODE_H + 8}
                    rx={17}
                    fill="none"
                    stroke="var(--fg)"
                    strokeWidth={2.5}
                    className="opacity-0 group-focus-visible:opacity-100"
                  />
                  <text x={14} y={26} className="fill-[var(--fg)] text-[14px] font-semibold">
                    {p.node.title.length > 24 ? `${p.node.title.slice(0, 23)}…` : p.node.title}
                  </text>
                  <text x={14} y={46} className="fill-[var(--fg-3)] text-[12px]">
                    {t(`roadmaps.kind.${p.node.kind}`)} ·{' '}
                    {t('roadmaps.aboutHours', { min: p.node.estimateHours[0], max: p.node.estimateHours[1] })}
                  </text>
                  {isDone && (
                    <g transform={`translate(${NODE_W - 26} 10)`} aria-hidden>
                      <circle cx={8} cy={8} r={9} fill="var(--success)" />
                      <path
                        d="M4 8.5 L7 11.5 L12.5 5.5"
                        stroke="var(--surface-1)"
                        strokeWidth={2}
                        fill="none"
                      />
                    </g>
                  )}
                </g>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="border-t border-line px-3 py-2 text-caption text-fg-3">{t('roadmaps.graphLegend')}</p>
    </Card>
  );
}
