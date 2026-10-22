import { useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { ROADMAP_CATEGORIES, type RoadmapCategory, type RoadmapSummaryView } from '@campuslink/shared';
import { cn } from '../../lib/cn';
import { layoutGalaxy, wrapLabel } from '../../lib/roadmaps';

/** Colour per category (design tokens only); stars glow in it over deep space. */
const HUE: Record<RoadmapCategory, string> = {
  software: 'var(--brand)',
  'data-ai': 'var(--brand-2)',
  security: 'var(--danger)',
  'design-product': 'var(--warning)',
  'core-engineering': 'var(--accent)',
  'exams-higher-studies': 'var(--info)',
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

/** Faint background stars, the same on every visit (a seeded generator, not Math.random). */
function starfield(width: number, height: number) {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: Math.round((width * height) / 5000) }, (_, i) => ({
    x: rnd() * width,
    y: rnd() * height,
    r: 0.5 + rnd() * 1.1,
    o: 0.25 + rnd() * 0.5,
    twinkle: i % 9 === 0,
  }));
}

/**
 * The Career Galaxy (§8.8): deep space, one constellation per category, one star per roadmap.
 * A star's aurora ring is the member's progress on it. Drag to pan once zoomed in, pinch or the
 * buttons to zoom; every star is a link with a full label for screen readers, and the List view
 * is the equal alternative. Loads only when the Galaxy view is shown.
 */
export function GalaxyCanvas({ roadmaps }: { roadmaps: RoadmapSummaryView[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ids = useId().replace(/[^a-zA-Z0-9]/g, '');
  // One column on phones so labels stay large enough to read.
  const [columns] = useState(() =>
    typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches ? 1 : 2,
  );
  const { groups, width, height } = useMemo(
    () => layoutGalaxy(roadmaps, ROADMAP_CATEGORIES, columns),
    [roadmaps, columns],
  );
  const stars = useMemo(() => starfield(width, height), [width, height]);
  const [focus, setFocus] = useState<RoadmapSummaryView | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; dist: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  /** Screen pixels → viewBox units (the SVG scales to fit its box). */
  const unit = () => {
    const r = svg.current?.getBoundingClientRect();
    return r ? Math.max(width / r.width, height / r.height) : 1;
  };
  const clamp = (v: { x: number; y: number; k: number }) => {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k));
    // Keep some of the galaxy on screen whatever the pan.
    const x = Math.min(0, Math.max(width * (1 - k), v.x));
    const y = Math.min(0, Math.max(height * (1 - k), v.y));
    return { x, y, k };
  };
  const zoomAt = (factor: number, cx = width / 2, cy = height / 2) =>
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      return clamp({ k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k });
    });

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('a')) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = null;
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const u = unit();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      // Pinch: zoom around the midpoint.
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = svg.current?.getBoundingClientRect();
      if (gesture.current && r)
        zoomAt(dist / gesture.current.dist, ((a.x + b.x) / 2 - r.left) * u, ((a.y + b.y) / 2 - r.top) * u);
      gesture.current = { x: 0, y: 0, dist };
      return;
    }
    if (view.k === 1) return;
    setView((v) => clamp({ ...v, x: v.x + (e.clientX - prev.x) * u, y: v.y + (e.clientY - prev.y) * u }));
  };
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (!pointers.current.size) setDragging(false);
  };

  const aurora = `aur${ids}`;
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-xl)] border border-line bg-space text-on-space shadow-elev-2">
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={t('roadmaps.galaxyLabel')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => {
          // Trackpad pinch and Ctrl+wheel zoom; a plain wheel keeps scrolling the page.
          if (!e.ctrlKey) return;
          e.preventDefault();
          const r = svg.current?.getBoundingClientRect();
          const u = unit();
          if (r) zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, (e.clientX - r.left) * u, (e.clientY - r.top) * u);
        }}
        className={cn(
          'block max-h-[min(78vh,760px)] w-full select-none',
          view.k > 1 ? 'cursor-grab touch-none active:cursor-grabbing' : 'touch-pan-y',
        )}
      >
        <defs>
          <linearGradient id={aurora} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--aurora-1)" />
            <stop offset="0.5" stopColor="var(--aurora-2)" />
            <stop offset="1" stopColor="var(--aurora-3)" />
          </linearGradient>
          {groups.map((g) => (
            <radialGradient key={g.category} id={`neb-${ids}-${g.category}`}>
              <stop offset="0" stopColor={HUE[g.category as RoadmapCategory]} stopOpacity="0.32" />
              <stop offset="1" stopColor={HUE[g.category as RoadmapCategory]} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>
        <g
          // Button zooms glide; drags and pinches follow the fingers exactly.
          className={dragging ? undefined : 'transition-transform duration-[var(--dur-base)] ease-out'}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
            transformOrigin: '0 0',
          }}
        >
          <g aria-hidden>
            {stars.map((s, i) => (
              <circle
                key={i}
                cx={s.x}
                cy={s.y}
                r={s.r}
                fill="var(--on-space)"
                opacity={s.o}
                className={s.twinkle ? 'twinkle' : undefined}
                style={s.twinkle ? { animationDelay: `${(i % 7) * 0.6}s` } : undefined}
              />
            ))}
          </g>
          {groups.map((g) => {
            const hue = HUE[g.category as RoadmapCategory];
            // Constellation lines join the stars in order around the centre.
            const ring = [...g.stars].sort(
              (a, b) => Math.atan2(a.y - g.cy, a.x - g.cx) - Math.atan2(b.y - g.cy, b.x - g.cx),
            );
            return (
              <g key={g.category}>
                <circle cx={g.cx} cy={g.cy} r={190} fill={`url(#neb-${ids}-${g.category})`} aria-hidden />
                <text
                  x={g.cx}
                  y={g.titleY}
                  textAnchor="middle"
                  fill="var(--on-space-2)"
                  className="font-display text-[19px] font-semibold tracking-wide"
                  aria-hidden
                >
                  {t(`roadmaps.cat.${g.category}`)}
                </text>
                {ring.length > 1 && (
                  <polyline
                    points={[...ring, ...(ring.length > 2 ? [ring[0]] : [])]
                      .map((s) => `${s?.x},${s?.y}`)
                      .join(' ')}
                    fill="none"
                    stroke="var(--on-space-2)"
                    strokeOpacity={0.28}
                    strokeWidth={1.2}
                    aria-hidden
                  />
                )}
                {g.stars.map((s) => {
                  const p = s.roadmap.progress;
                  const done = p ? p.done / Math.max(1, p.total) : 0;
                  const lines = wrapLabel(s.roadmap.title);
                  const lift = s.label.anchor === 'middle' && s.label.y < s.y ? (lines.length - 1) * 17 : 0;
                  return (
                    <a
                      key={s.roadmap.id}
                      href={`/roadmaps/${s.roadmap.slug}`}
                      aria-label={`${s.roadmap.title}, ${t('roadmaps.steps', { count: s.roadmap.nodeCount })}${
                        p ? `, ${t('roadmaps.doneOf', p)}` : ''
                      }`}
                      onClick={(e) => {
                        e.preventDefault();
                        void navigate(`/roadmaps/${s.roadmap.slug}`);
                      }}
                      onFocus={() => setFocus(s.roadmap)}
                      onMouseEnter={() => setFocus(s.roadmap)}
                      className="group outline-none"
                    >
                      <circle cx={s.x} cy={s.y} r={s.r + 14} fill={hue} opacity={0.14 + done * 0.2} />
                      <circle
                        cx={s.x}
                        cy={s.y}
                        r={s.r}
                        fill={hue}
                        stroke="var(--on-space)"
                        strokeOpacity={0.85}
                        strokeWidth={1.5}
                      />
                      {/* Progress, lit in aurora (completed steps). */}
                      {done > 0 && (
                        <circle
                          cx={s.x}
                          cy={s.y}
                          r={s.r + 6}
                          fill="none"
                          stroke={`url(#${aurora})`}
                          strokeWidth={3.5}
                          strokeLinecap="round"
                          pathLength={100}
                          strokeDasharray={`${Math.max(4, done * 100)} 100`}
                          transform={`rotate(-90 ${s.x} ${s.y})`}
                        />
                      )}
                      <circle
                        cx={s.x}
                        cy={s.y}
                        r={s.r + 13}
                        fill="none"
                        stroke="var(--on-space)"
                        strokeWidth={3}
                        className="opacity-0 group-hover:opacity-50 group-focus-visible:opacity-100"
                      />
                      <text
                        x={s.label.x}
                        y={s.label.y - lift}
                        textAnchor={s.label.anchor}
                        fill="var(--on-space)"
                        className="pointer-events-none text-[15px] font-medium"
                      >
                        {lines.map((line, i) => (
                          <tspan key={i} x={s.label.x} dy={i ? 17 : 0}>
                            {line}
                          </tspan>
                        ))}
                      </text>
                    </a>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute top-3 right-3 grid gap-1.5">
        {(
          [
            ['in', Plus, () => zoomAt(1.4)],
            ['out', Minus, () => zoomAt(1 / 1.4)],
            ['reset', Maximize2, () => setView({ x: 0, y: 0, k: 1 })],
          ] as const
        ).map(([k, Icon, run]) => (
          <button
            key={k}
            type="button"
            onClick={run}
            aria-label={t(`roadmaps.zoom.${k}`)}
            disabled={(k === 'in' && view.k >= MAX_ZOOM) || (k !== 'in' && view.k <= MIN_ZOOM)}
            className="glass grid size-11 place-items-center rounded-full border border-line text-fg shadow-elev-2 transition-[scale] active:scale-90 disabled:opacity-50"
          >
            <Icon className="size-5" aria-hidden />
          </button>
        ))}
      </div>
      <p className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 text-caption text-on-space-2">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle cx="9" cy="9" r="7" fill="none" stroke={`url(#${aurora})`} strokeWidth="2.5" />
        </svg>
        {t('roadmaps.legend')}
      </p>
      {focus && (
        <p
          className="glass pointer-events-none absolute inset-x-3 bottom-11 rounded-[var(--radius-md)] border border-line p-3 text-meta text-fg shadow-elev-3 sm:right-auto sm:max-w-[420px]"
          aria-live="polite"
        >
          <span className="font-semibold">{focus.title}</span> · {focus.summary.slice(0, 140)}
          {focus.summary.length > 140 ? '…' : ''}
        </p>
      )}
    </div>
  );
}
