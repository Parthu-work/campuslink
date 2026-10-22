import type { SyllabusInput, SyllabusView } from '@campuslink/shared';
import { accentOf } from './accent';

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
