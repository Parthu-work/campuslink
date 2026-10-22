import { useId } from 'react';

export type IllustrationKind =
  'empty' | 'search' | 'offline' | 'error' | 'done' | 'people' | 'calendar' | 'study';

/**
 * Small original illustrations for empty, error and success states (master prompt §9): simple
 * shapes in the college's aurora colours, so they belong to every college. Decorative only.
 */
export function Illustration({ kind, size = 112 }: { kind: IllustrationKind; size?: number }) {
  const g = `ill${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const aurora = `url(#${g})`;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden className="flex-none">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--aurora-1)" />
          <stop offset="0.55" stopColor="var(--aurora-2)" />
          <stop offset="1" stopColor="var(--aurora-3)" />
        </linearGradient>
      </defs>
      {/* A soft halo and an orbit, shared by every scene. */}
      <circle cx="60" cy="60" r="50" fill="var(--brand-surface)" />
      <ellipse
        cx="60"
        cy="64"
        rx="46"
        ry="15"
        fill="none"
        stroke="var(--line-strong)"
        strokeWidth="1.5"
        strokeDasharray="3 5"
      />
      {kind === 'empty' && (
        <>
          <rect
            x="36"
            y="34"
            width="48"
            height="40"
            rx="10"
            fill="var(--surface-1)"
            stroke="var(--line-strong)"
            strokeWidth="2"
          />
          <path d="M44 48h32M44 58h20" stroke="var(--fg-3)" strokeWidth="3" strokeLinecap="round" />
          <circle cx="84" cy="34" r="9" fill={aurora} />
        </>
      )}
      {kind === 'search' && (
        <>
          <circle cx="54" cy="54" r="18" fill="var(--surface-1)" stroke={aurora} strokeWidth="5" />
          <path d="m67 67 14 14" stroke={aurora} strokeWidth="6" strokeLinecap="round" />
          <circle cx="86" cy="36" r="3" fill="var(--aurora-3)" />
        </>
      )}
      {kind === 'offline' && (
        <>
          <path
            d="M34 58a36 36 0 0 1 52 0M43 67a23 23 0 0 1 34 0"
            fill="none"
            stroke="var(--fg-3)"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle cx="60" cy="78" r="5" fill={aurora} />
          <path d="M38 38l44 44" stroke="var(--danger-fg)" strokeWidth="4" strokeLinecap="round" />
        </>
      )}
      {kind === 'error' && (
        <>
          <path
            d="M60 30 88 80H32z"
            fill="var(--surface-1)"
            stroke={aurora}
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <path d="M60 48v14" stroke="var(--fg-2)" strokeWidth="4" strokeLinecap="round" />
          <circle cx="60" cy="70" r="2.8" fill="var(--fg-2)" />
        </>
      )}
      {kind === 'done' && (
        <>
          <circle cx="60" cy="56" r="22" fill={aurora} />
          <path
            d="m50 56 7 7 14-15"
            fill="none"
            stroke="var(--on-aurora)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="90" cy="34" r="3" fill="var(--aurora-2)" />
          <circle cx="30" cy="40" r="2" fill="var(--aurora-1)" />
        </>
      )}
      {kind === 'people' && (
        <>
          <circle
            cx="46"
            cy="50"
            r="10"
            fill="var(--surface-1)"
            stroke="var(--line-strong)"
            strokeWidth="2"
          />
          <path
            d="M30 78c2-10 9-15 16-15s14 5 16 15"
            fill="var(--surface-1)"
            stroke="var(--line-strong)"
            strokeWidth="2"
          />
          <circle cx="74" cy="46" r="12" fill={aurora} />
          <path d="M56 80c2-12 10-18 18-18s16 6 18 18" fill={aurora} />
        </>
      )}
      {kind === 'calendar' && (
        <>
          <rect
            x="34"
            y="36"
            width="52"
            height="46"
            rx="10"
            fill="var(--surface-1)"
            stroke="var(--line-strong)"
            strokeWidth="2"
          />
          <rect x="34" y="36" width="52" height="13" rx="6" fill={aurora} />
          <circle cx="48" cy="62" r="3.5" fill="var(--fg-3)" />
          <circle cx="60" cy="62" r="3.5" fill="var(--fg-3)" />
          <circle cx="72" cy="62" r="3.5" fill="var(--aurora-3)" />
        </>
      )}
      {kind === 'study' && (
        <>
          <path
            d="M30 44c10-4 20-4 30 2v36c-10-6-20-6-30-2z"
            fill="var(--surface-1)"
            stroke="var(--line-strong)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M90 44c-10-4-20-4-30 2v36c10-6 20-6 30-2z" fill={aurora} />
          <circle cx="88" cy="32" r="3" fill="var(--aurora-2)" />
        </>
      )}
    </svg>
  );
}
