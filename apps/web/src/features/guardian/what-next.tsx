import { ShieldCheck, Users } from 'lucide-react';
import { useTranslation } from '../../i18n/react';

/**
 * The minor path's "what happens next" (prompt 3, U4): three plain steps under a small picture of
 * a member and their guardian, shown when the birth month says under 18 and again on the guardian
 * screen, so nothing about the wait is a surprise.
 */
export function WhatHappensNext({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const { t } = useTranslation();
  const Heading = `h${headingLevel}` as const;
  const steps = (['record', 'read', 'done'] as const).map((k) => ({
    title: t(`guardianNext.${k}`),
    body: t(`guardianNext.${k}Body`),
  }));
  return (
    <section
      aria-labelledby="what-happens-next"
      className="grid gap-4 rounded-[var(--radius-md)] border border-line bg-surface-1 p-4"
    >
      <div className="flex items-center gap-3">
        <span
          className="relative grid size-12 flex-none place-items-center rounded-full bg-brand-surface"
          aria-hidden
        >
          <Users className="size-6 text-brand-ink" />
          <ShieldCheck className="absolute -right-1 -bottom-1 size-5 rounded-full bg-surface-1 text-brand-ink" />
        </span>
        <Heading id="what-happens-next" className="text-headline font-semibold">
          {t('guardianNext.title')}
        </Heading>
      </div>
      <ol className="grid gap-3">
        {steps.map((s, i) => (
          <li key={s.title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2">
            <span
              className="grid size-7 place-items-center rounded-full border border-line text-callout font-semibold text-fg-2"
              aria-hidden
            >
              {i + 1}
            </span>
            <div>
              <p className="text-body font-medium">{s.title}</p>
              <p className="text-callout text-fg-2">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
