import type { ReactNode } from 'react';
import type { FirstPaintSlot } from '../../lib/first-paint';

/**
 * The landing's frame (prompt 3, U4): exactly the markup index.html draws before any script runs
 * (`#fp`), so the app can render into that frame instead of drawing a second headline
 * (lib/first-paint.ts). The layout lives in index.css (`.landing…`); frame.test.tsx compares this
 * component with index.html.
 */
export function LandingFrame({
  id,
  headline,
  slots = {},
}: {
  id?: string;
  headline: ReactNode;
  slots?: Partial<Record<FirstPaintSlot, ReactNode>>;
}) {
  return (
    <div id={id} className="landing">
      <div className="landing-backdrop" data-slot="backdrop">
        {slots.backdrop}
      </div>
      <div className="landing-header" data-slot="header">
        {slots.header}
      </div>
      <main id="main" className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-h1">
          <div className="landing-copy">
            {headline}
            <div className="landing-copy-rest" data-slot="copy">
              {slots.copy}
            </div>
          </div>
          <div className="landing-figure" data-slot="figure">
            {slots.figure}
          </div>
        </section>
        <div className="landing-below" data-slot="below">
          {slots.below}
        </div>
      </main>
      <div className="landing-footer" data-slot="footer">
        {slots.footer}
      </div>
    </div>
  );
}

/** The outcome headline, the page's largest paint; its second half carries the brand gradient. */
export function Headline({ a, b }: { a: string; b: string }) {
  return (
    <h1 id="landing-h1" className="landing-h1">
      {a}
      <em>{b}</em>
    </h1>
  );
}
