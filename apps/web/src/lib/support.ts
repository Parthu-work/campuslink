import { HELP_ARTICLES, type HelpArticleId, type Locale } from '@campuslink/shared';

/** Badge tones for a problem report's status (B14). */
export const SUPPORT_STATUS_TONE = { open: 'warning', answered: 'success', closed: 'neutral' } as const;

/** Help-centre articles: one markdown file per language, each loaded only when opened. */
const articles = import.meta.glob<string>('../features/help/articles/*/*.md', {
  query: '?raw',
  import: 'default',
});

export const isHelpArticle = (id: string | undefined): id is HelpArticleId =>
  !!id && (HELP_ARTICLES as readonly string[]).includes(id);

/** An article in the member's language (English when that language has none). */
export async function loadHelpArticle(id: HelpArticleId, locale: Locale): Promise<string> {
  const own = articles[`../features/help/articles/${locale}/${id}.md`];
  const en = articles[`../features/help/articles/en/${id}.md`];
  const load = own ?? en;
  return load ? load() : '';
}
