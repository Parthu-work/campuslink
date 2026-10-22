import { useId } from 'react';

/**
 * Job Radar's mark: rings, a few blips and a sweep that turns (transform only; still under reduced
 * motion). Sized by the text around it (1em). Decorative.
 */
export function RadarSweep() {
  const g = `sweep${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg viewBox="0 0 48 48" width="1em" height="1em" aria-hidden className="flex-none overflow-visible">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--brand)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--brand)" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <circle
        cx="24"
        cy="24"
        r="22"
        fill="var(--brand-surface)"
        stroke="var(--brand-ink)"
        strokeWidth="1.5"
      />
      <circle
        cx="24"
        cy="24"
        r="14"
        fill="none"
        stroke="var(--brand-ink)"
        strokeOpacity="0.45"
        strokeWidth="1"
      />
      <circle
        cx="24"
        cy="24"
        r="6"
        fill="none"
        stroke="var(--brand-ink)"
        strokeOpacity="0.45"
        strokeWidth="1"
      />
      <g className="radar-sweep">
        <path d="M24 24 L46 24 A22 22 0 0 0 39.6 8.4 Z" fill={`url(#${g})`} />
        <line
          x1="24"
          y1="24"
          x2="46"
          y2="24"
          stroke="var(--brand-ink)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </g>
      <circle cx="33" cy="15" r="2.2" fill="var(--aurora-2)" />
      <circle cx="15" cy="31" r="1.8" fill="var(--aurora-3)" />
      <circle cx="29" cy="34" r="1.5" fill="var(--aurora-1)" />
    </svg>
  );
}
