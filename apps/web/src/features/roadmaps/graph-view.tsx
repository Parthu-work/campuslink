import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { Check, Minus, Plus, Scan } from 'lucide-react';
import { nextStep, type RoadmapView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { useSeesReview } from './sees-review';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/misc';
import { NODE_H, NODE_W, layoutGraph } from '../../lib/roadmaps';
import { useWidth } from '../../lib/use-width';
import { cn } from '../../lib/cn';

const PAD = 24;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

/**
 * The path as a map of its steps and how they connect (prompt 3, U3): for those who want the whole
 * graph (the journey is the default view), loaded only when chosen. It opens fitted to the screen
 * (never below three quarters of life size, so titles stay readable) with the next step in the middle; step titles wrap instead of being cut; it pans by dragging or
 * scrolling and zooms by pinching, Ctrl + wheel, the + and − keys or the buttons. A small key
 * replaces the old legend paragraph.
 */
export function GraphView({ roadmap, onOpen }: { roadmap: RoadmapView; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const showReview = useSeesReview();
  const nodes = roadmap.content.nodes;
  const { placed, width, height } = useMemo(() => layoutGraph(nodes), [nodes]);
  const done = useMemo(() => new Set(roadmap.myProgress?.done ?? []), [roadmap.myProgress]);
  const next = done.size < nodes.length ? nextStep(nodes, done)?.id : undefined;
  const pos = new Map(placed.map((p) => [p.node.id, p]));
  const w = width + PAD * 2;
  const h = height + PAD * 2;
  const { ref: frame, width: frameWidth } = useWidth<HTMLDivElement>(0);
  const scroller = useRef<HTMLDivElement>(null);
  // Fitted to the frame's width on open (never larger than life); null until measured.
  const fit = frameWidth > 0 ? clampZoom(Math.min(1, Math.max(0.75, frameWidth / w))) : null;
  const [zoom, setZoom] = useState<number | null>(null);
  const z = zoom ?? fit ?? 1;

  // The next step in the middle once the map has its size (and again if the next step changes).
  useEffect(() => {
    const el = scroller.current;
    const target = next ? pos.get(next) : undefined;
    if (!el || !target || fit === null) return;
    el.scrollTo({
      left: (target.x + PAD + NODE_W / 2) * z - el.clientWidth / 2,
      top: (target.y + PAD + NODE_H / 2) * z - el.clientHeight / 2,
    });
    // Only on open and when the next step moves on, not on every zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, fit === null]);

  /** Zooms about a point of the frame (the pinch's middle, the pointer), keeping it in place. */
  const zoomTo = (to: number, at?: { x: number; y: number }) => {
    const el = scroller.current;
    const nz = clampZoom(to);
    if (!el) return setZoom(nz);
    const ax = at?.x ?? el.clientWidth / 2;
    const ay = at?.y ?? el.clientHeight / 2;
    const cx = (el.scrollLeft + ax) / z;
    const cy = (el.scrollTop + ay) / z;
    setZoom(nz);
    requestAnimationFrame(() => el.scrollTo({ left: cx * nz - ax, top: cy * nz - ay }));
  };

  // Two fingers pinch; one finger (or a mouse) drags to pan.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: z };
      drag.current = null;
    } else if (
      e.pointerType === 'mouse' &&
      e.button === 0 &&
      !(e.target as Element).closest('[role=button]')
    ) {
      const el = scroller.current;
      if (el) drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const el = scroller.current;
    if (pinch.current && pointers.current.size === 2 && el) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const box = el.getBoundingClientRect();
      zoomTo(pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist), {
        x: (a.x + b.x) / 2 - box.left,
        y: (a.y + b.y) / 2 - box.top,
      });
    } else if (drag.current && el) {
      el.scrollTo({
        left: drag.current.left - (e.clientX - drag.current.x),
        top: drag.current.top - (e.clientY - drag.current.y),
      });
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!pointers.current.size) drag.current = null;
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    // A trackpad pinch arrives as Ctrl + wheel; plain wheel scrolls (pans) as usual.
    if (!e.ctrlKey) return;
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    zoomTo(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: e.clientX - box.left, y: e.clientY - box.top });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === '+' || e.key === '=') zoomTo(z + 0.2);
    else if (e.key === '-' || e.key === '_') zoomTo(z - 0.2);
    else if (e.key === '0') setZoom(null);
    else return;
    e.preventDefault();
  };

  const key: [string, string][] = [
    ['done', t('roadmaps.done')],
    ['next', t('ui.stepNext')],
    ['project', t('roadmaps.kind.project')],
    ...(showReview ? ([['review', t('roadmaps.needsReview')]] as [string, string][]) : []),
  ];

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-1.5 pl-3">
        {/* A small key instead of a paragraph. */}
        <ul
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-2"
          aria-label={t('roadmaps.mapKey')}
        >
          {key.map(([k, label]) => (
            <li key={k} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  'inline-block size-3 rounded-[4px] border-2',
                  k === 'done' && 'border-success bg-success-surface',
                  k === 'next' && 'border-brand bg-brand-surface',
                  k === 'project' && 'border-accent',
                  k === 'review' && 'border-dashed border-line-strong',
                )}
              />
              {label}
            </li>
          ))}
        </ul>
        <div className="flex gap-1">
          <Button
            variant="tertiary"
            size="icon"
            aria-label={t('roadmaps.zoomOut')}
            onClick={() => zoomTo(z - 0.2)}
          >
            <Minus aria-hidden />
          </Button>
          <Button
            variant="tertiary"
            size="icon"
            aria-label={t('roadmaps.zoomFit')}
            onClick={() => setZoom(null)}
          >
            <Scan aria-hidden />
          </Button>
          <Button
            variant="tertiary"
            size="icon"
            aria-label={t('roadmaps.zoomIn')}
            onClick={() => zoomTo(z + 0.2)}
          >
            <Plus aria-hidden />
          </Button>
        </div>
      </div>
      <div ref={frame}>
        <div
          ref={scroller}
          className="max-h-[70vh] [touch-action:pan-x_pan-y] overflow-auto overscroll-contain"
          tabIndex={0}
          role="region"
          aria-label={t('roadmaps.graphLabel')}
          aria-describedby="map-keys"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
        >
          <svg
            width={w * z}
            height={h * z}
            viewBox={`${-PAD} ${-PAD} ${w} ${h}`}
            className="block"
            role="list"
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
              const isNext = p.node.id === next;
              return (
                <g key={p.node.id} role="listitem" transform={`translate(${p.x} ${p.y})`}>
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={`${p.node.title}, ${t(`roadmaps.kind.${p.node.kind}`)}${isDone ? `, ${t('roadmaps.done')}` : ''}${isNext ? `, ${t('ui.stepNext')}` : ''}${showReview && p.node.needsReview ? `, ${t('roadmaps.needsReview')}` : ''}`}
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
                      rx={12}
                      fill={
                        isDone
                          ? 'var(--success-surface)'
                          : isNext
                            ? 'var(--brand-surface)'
                            : 'var(--surface-1)'
                      }
                      stroke={
                        isDone
                          ? 'var(--success)'
                          : isNext
                            ? 'var(--brand)'
                            : p.node.kind === 'project'
                              ? 'var(--accent)'
                              : 'var(--line-strong)'
                      }
                      strokeWidth={isDone || isNext || p.node.kind === 'project' ? 2.5 : 1.5}
                      strokeDasharray={showReview && p.node.needsReview ? '6 4' : undefined}
                      className="transition-[stroke] group-hover:stroke-[var(--brand)]"
                    />
                    <rect
                      x={-4}
                      y={-4}
                      width={NODE_W + 8}
                      height={NODE_H + 8}
                      rx={15}
                      fill="none"
                      stroke="var(--focus-ring)"
                      strokeWidth={2.5}
                      className="opacity-0 group-focus-visible:opacity-100"
                    />
                    {/* HTML inside the node so the title wraps (up to three lines, the rest in the
                        step's own name above). */}
                    <foreignObject
                      x={12}
                      y={8}
                      width={NODE_W - 24 - (isDone ? 18 : 0)}
                      height={NODE_H - 16}
                      aria-hidden
                    >
                      <div className="grid h-full content-center gap-0.5 text-fg">
                        <span className="line-clamp-3 text-callout leading-tight font-semibold break-words">
                          {p.node.title}
                        </span>
                      </div>
                    </foreignObject>
                    {isDone && (
                      <g transform={`translate(${NODE_W - 26} 10)`} aria-hidden>
                        <circle cx={8} cy={8} r={9} fill="var(--success)" />
                        <foreignObject x={1} y={1} width={14} height={14}>
                          <Check className="size-3.5 text-[var(--surface-1)]" strokeWidth={3} />
                        </foreignObject>
                      </g>
                    )}
                  </g>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <p id="map-keys" className="sr-only">
        {t('roadmaps.mapKeys')}
      </p>
    </Card>
  );
}
