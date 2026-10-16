/**
 * Spam and low-quality filters for automated items. `rejected` items are never stored as visible;
 * `held` items wait in the moderation queue; everything else is published.
 */
const SPAM =
  /\b(casino|betting|satta|lottery|jackpot|escort|viagra|crypto airdrop|free crypto|loan approval|instant loan|earn money (fast|from home)|work from home and earn|click here to claim|giveaway winner)\b/i;
const CLICKBAIT = /\b(you won'?t believe|shocking|goes viral|this one trick|what happened next|must see)\b/i;

export interface Verdict {
  status: 'published' | 'held' | 'rejected';
  reasons: string[];
}

export function judge(item: { title: string; snippet: string; rawLinks?: number }): Verdict {
  const reasons: string[] = [];
  const text = `${item.title} ${item.snippet}`;
  if (item.title.length < 8) return { status: 'rejected', reasons: ['title_too_short'] };
  if (SPAM.test(text)) return { status: 'rejected', reasons: ['spam_terms'] };
  const letters = item.title.replace(/[^A-Za-z]/g, '');
  if (letters.length > 20 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7)
    reasons.push('all_caps');
  if (/[!?]{3,}/.test(item.title)) reasons.push('punctuation');
  if (CLICKBAIT.test(text)) reasons.push('clickbait');
  if (!item.snippet && item.title.length < 25) reasons.push('thin');
  if ((item.rawLinks ?? 0) > 5) reasons.push('link_heavy');
  return { status: reasons.length ? 'held' : 'published', reasons };
}
