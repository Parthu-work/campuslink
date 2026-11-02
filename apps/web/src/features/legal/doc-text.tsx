import { RichText } from '../../components/ui/rich-text';

/**
 * A long document in the markdown subset with `## ` section headings (legal pages and help
 * articles). Each section's text goes through RichText, so nothing is rendered as HTML.
 */
export function DocText({ text, headingLevel = 2 }: { text: string; headingLevel?: 2 | 3 }) {
  const parts = text.split(/^## (.+)$/m);
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const sections: { heading: string | null; body: string }[] = [{ heading: null, body: parts[0] ?? '' }];
  for (let i = 1; i < parts.length; i += 2)
    sections.push({ heading: parts[i] ?? '', body: parts[i + 1] ?? '' });
  return (
    <div className="grid gap-5">
      {sections
        .filter((s) => s.heading || s.body.trim())
        .map((s, i) => (
          <section key={i} className="grid gap-2">
            {s.heading && <H className="text-title font-semibold">{s.heading}</H>}
            {s.body.trim() && <RichText text={s.body.trim()} className="text-body text-fg-2" />}
          </section>
        ))}
    </div>
  );
}
