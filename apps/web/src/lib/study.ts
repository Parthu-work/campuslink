import type { SyllabusInput, SyllabusView, SyllabusTopicView } from '@campuslink/shared';
import { accentOf } from './accent';

/** 65 → "1:05", 3723 → "1:02:03". */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** "1:05 Pumping lemma" lines → chapters (lines that do not start with a time are ignored). */
export function parseChapters(text: string): { at: number; title: string }[] {
  const out: { at: number; title: string }[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    out.push({
      at: Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]),
      title: (m[4] ?? '').slice(0, 120),
    });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 100);
}

/** Topics whose title words or keywords appear in a file name: the upload form's suggestion. */
export function suggestTopics(name: string, topics: (SyllabusTopicView & { unitId: string })[]): string[] {
  const words = new Set(
    name
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .split(/[^\p{L}\p{M}\p{N}]+/u)
      .filter((w) => w.length > 2),
  );
  return topics
    .map((t) => {
      const tw = t.title
        .toLowerCase()
        .split(/[^\p{L}\p{M}\p{N}]+/u)
        .filter((w) => w.length > 2);
      const hits =
        tw.filter((w) => words.has(w)).length +
        t.keywords.filter((k) => words.has(k.toLowerCase())).length * 2;
      return { id: t.id, score: tw.length ? hits / tw.length : hits };
    })
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.id);
}

/** A subject's own colour (one of the eight generated subject accents), from its code. */
export function subjectAccent(code: string) {
  const n = accentOf(code);
  return {
    solid: `var(--subject-${n})`,
    surface: `var(--subject-${n}-surface)`,
    ink: `var(--subject-${n}-ink)`,
  };
}

/** "2026, 2027 2028" → [2026, 2027, 2028] (four-digit years only, no repeats). */
export function parseBatches(text: string): number[] {
  return [...new Set((text.match(/\b(19[5-9]\d|20\d\d|2100)\b/g) ?? []).map(Number))].sort();
}

/** An editable syllabus tree: units and topics keep their ids so material tags survive edits. */
export interface DraftTopic {
  key: string;
  id?: string;
  title: string;
  keywords: string[];
}
export interface DraftUnit {
  key: string;
  id?: string;
  title: string;
  topics: DraftTopic[];
}

let seq = 0;
export const draftKey = () => `d${++seq}`;

export function toDraft(tree: SyllabusView | SyllabusInput): DraftUnit[] {
  return tree.units.map((u) => ({
    key: draftKey(),
    ...('id' in u && u.id ? { id: u.id } : {}),
    title: u.title,
    topics: u.topics.map((t) => ({
      key: draftKey(),
      ...('id' in t && t.id ? { id: t.id } : {}),
      title: t.title,
      keywords: t.keywords ?? [],
    })),
  }));
}

export function fromDraft(units: DraftUnit[]): SyllabusInput {
  return {
    units: units
      .filter((u) => u.title.trim())
      .map((u) => ({
        ...(u.id ? { id: u.id } : {}),
        title: u.title.trim(),
        topics: u.topics
          .filter((t) => t.title.trim())
          .map((t) => ({ ...(t.id ? { id: t.id } : {}), title: t.title.trim(), keywords: t.keywords })),
      })),
  };
}

/** Moves an item one place up or down (keyboard-friendly re-ordering, no drag needed). */
export function move<T>(list: T[], from: number, by: -1 | 1): T[] {
  const to = from + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}
