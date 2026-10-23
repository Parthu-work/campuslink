import {
  CHAT_DIFFICULTIES,
  SERVER_COMMANDS,
  SLASH_COMMANDS,
  type ChatCitation,
  type ChatDifficulty,
  type ServerCommand,
  type SlashCommand,
  type SubjectView,
} from '@campuslink/shared';

export const isServerCommand = (c: SlashCommand | null): c is ServerCommand =>
  !!c && (SERVER_COMMANDS as readonly string[]).includes(c);

/** "/videos pumping lemma" → the command and its argument; anything else is a plain question. */
export function parseCommand(input: string): {
  command: SlashCommand | null;
  arg: string;
  unknown: string | null;
} {
  const m = /^\/([a-z]+)\b\s*([\s\S]*)$/i.exec(input.trim());
  if (!m) return { command: null, arg: input.trim(), unknown: null };
  const name = (m[1] ?? '').toLowerCase();
  const command = (SLASH_COMMANDS as readonly string[]).includes(name) ? (name as SlashCommand) : null;
  return { command, arg: (m[2] ?? '').trim(), unknown: command ? null : name };
}

/** Commands for the menu while typing "/…" (prefix match, in menu order). */
export function commandMatches(input: string): SlashCommand[] {
  const m = /^\/([a-z]*)$/i.exec(input.trim());
  if (!m) return [];
  const prefix = (m[1] ?? '').toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.startsWith(prefix));
}

/** `/quiz <topic> [n]`: a trailing number is the question count. */
export function quizArgs(arg: string): { topic: string; count: number | undefined } {
  const m = /^(.*?)\s+(\d{1,2})$/.exec(arg);
  if (!m) return { topic: arg, count: undefined };
  return { topic: m[1] ?? '', count: Math.min(10, Math.max(3, Number(m[2]))) };
}

/** Where a citation opens: the PDF page or the video moment, with its words highlighted. */
export function citationHref(
  c: Pick<ChatCitation, 'subjectId' | 'materialId' | 'page' | 'startSec'>,
  q: string,
) {
  const at = c.startSec !== null ? `t=${Math.floor(c.startSec)}` : c.page ? `page=${c.page}` : '';
  const words = q
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 6)
    .join(' ');
  return `/study/${c.subjectId}/m/${c.materialId}?${[at, words ? `q=${encodeURIComponent(words)}` : '']
    .filter(Boolean)
    .join('&')}`;
}

/** `/subject <name>`: the readable subject whose code or name matches best. */
export function matchSubject(list: SubjectView[], name: string): SubjectView | null {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  return (
    list.find((s) => s.code.toLowerCase() === q) ??
    list.find((s) => s.name.toLowerCase() === q) ??
    list.find((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)) ??
    null
  );
}

/** Suggested questions from a subject's topics (no model needed). */
export function suggestionsFor(topics: string[]): { kind: 'explain' | 'videos' | 'quiz'; topic: string }[] {
  const picks = topics.slice(0, 3);
  return [
    ...picks.slice(0, 2).map((topic) => ({ kind: 'explain' as const, topic })),
    ...picks.slice(0, 1).map((topic) => ({ kind: 'videos' as const, topic })),
    ...picks.slice(1, 2).map((topic) => ({ kind: 'quiz' as const, topic })),
  ];
}

/** `/explain <topic> [easy|medium|hard]`: a trailing difficulty word. */
export function explainArgs(arg: string): { topic: string; difficulty: ChatDifficulty | undefined } {
  const m = /^(.*?)\s+(easy|medium|hard)$/i.exec(arg);
  const d = m?.[2]?.toLowerCase() as ChatDifficulty | undefined;
  return m && d && (CHAT_DIFFICULTIES as readonly string[]).includes(d)
    ? { topic: m[1] ?? '', difficulty: d }
    : { topic: arg, difficulty: undefined };
}

/** "Ask about this": the material open in the viewer and where the member is in it. */
export interface AskContext {
  materialId: string;
  title: string;
  page: number | null;
  startSec: number | null;
  text: string;
}
