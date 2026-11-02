import type { ReactNode } from 'react';
import type { ResumeContent, ResumeTemplate } from '@campuslink/shared';
import { cn } from '../../lib/cn';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The PDF's date style (`2024-06` → `Jun 2024`), so the preview reads the same as the download. */
const shortDate = (d: string) => (d.length === 7 ? `${MONTHS[Number(d.slice(5)) - 1]} ${d.slice(0, 4)}` : d);
const range = (start: string, end: string) =>
  start || end ? `${shortDate(start) || '?'} – ${end ? shortDate(end) : 'Present'}` : '';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="border-b border-line pb-0.5 text-[0.8em] font-bold tracking-wide uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Pair({ left, right }: { left: string; right: string }) {
  return (
    <p className="flex flex-wrap justify-between gap-x-3 font-semibold">
      <span>{left}</span>
      {right && <span className="font-normal text-fg-2">{right}</span>}
    </p>
  );
}

function Bullets({ items }: { items: string[] }) {
  const shown = items.filter(Boolean);
  return shown.length ? (
    <ul className="grid list-disc gap-0.5 pl-5">
      {shown.map((b, i) => (
        <li key={i}>{b}</li>
      ))}
    </ul>
  ) : null;
}

/**
 * A close reading of the PDF (one column, same order and headings), in English as the résumé is.
 * The download is the record; this is what the member edits against.
 */
export function ResumePreview({
  content: c,
  template,
}: {
  content: ResumeContent;
  template: ResumeTemplate;
}) {
  const contact = [
    c.basics.email,
    c.basics.phone,
    c.basics.location,
    ...c.basics.profiles.map((p) => p.url),
  ].filter(Boolean);
  return (
    <article
      lang="en"
      aria-label="Résumé preview"
      className={cn(
        'grid gap-3 rounded-[var(--radius-md)] border border-line bg-surface-1 text-fg shadow-elev-1',
        template === 'compact' ? 'p-5 text-[13px] leading-snug' : 'p-7 text-[14px] leading-normal',
      )}
    >
      <header className="grid gap-0.5">
        <p className="text-[1.6em] leading-tight font-bold">{c.basics.name}</p>
        {c.basics.label && <p className="text-fg-2">{c.basics.label}</p>}
        {!!contact.length && <p className="break-words text-fg-2">{contact.join(' | ')}</p>}
      </header>
      {c.basics.summary && (
        <Section title="Summary">
          <p>{c.basics.summary}</p>
        </Section>
      )}
      {!!c.education.length && (
        <Section title="Education">
          {c.education.map((e, i) => (
            <div key={i}>
              <Pair left={e.institution} right={range(e.startDate, e.endDate)} />
              <p>
                {[[e.studyType, e.area].filter(Boolean).join(', '), e.score ? `Score: ${e.score}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          ))}
        </Section>
      )}
      {!!c.work.length && (
        <Section title="Experience">
          {c.work.map((w, i) => (
            <div key={i}>
              <Pair left={`${w.position}, ${w.name}`} right={range(w.startDate, w.endDate)} />
              <Bullets items={w.highlights} />
            </div>
          ))}
        </Section>
      )}
      {!!c.projects.length && (
        <Section title="Projects">
          {c.projects.map((p, i) => (
            <div key={i}>
              <Pair left={p.name} right={p.url} />
              {p.description && <p>{p.description}</p>}
              <Bullets items={p.highlights} />
            </div>
          ))}
        </Section>
      )}
      {!!c.skills.length && (
        <Section title="Skills">
          {c.skills.map((s, i) => (
            <p key={i}>{s.keywords.length ? `${s.name}: ${s.keywords.join(', ')}` : s.name}</p>
          ))}
        </Section>
      )}
      {!!c.certificates.length && (
        <Section title="Certificates">
          {c.certificates.map((x, i) => (
            <p key={i}>{[x.name, x.issuer, shortDate(x.date)].filter(Boolean).join(' · ')}</p>
          ))}
        </Section>
      )}
      {!!c.awards.length && (
        <Section title="Awards">
          {c.awards.map((x, i) => (
            <p key={i}>{[x.title, x.awarder, shortDate(x.date)].filter(Boolean).join(' · ')}</p>
          ))}
        </Section>
      )}
    </article>
  );
}
