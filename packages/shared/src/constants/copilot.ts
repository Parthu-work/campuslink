/**
 * The Career Copilot (prompt 2, G11): source kinds, commands and limits. Zod-free on purpose:
 * screens that only need these values never load Zod (bundle budget).
 */

/**
 * Where an answer's numbered sources come from. The first four are indexed per college (search
 * by words and by meaning through `VectorIndex`); `mentor` cards and the member's own facts (`me`)
 * are read live for each question, with the viewer's rights.
 */
export const COPILOT_SOURCE_KINDS = ['company', 'experience', 'roadmap', 'drive', 'mentor', 'me'] as const;
export type CopilotSourceKind = (typeof COPILOT_SOURCE_KINDS)[number];
export const COPILOT_INDEXED_KINDS = ['company', 'experience', 'roadmap', 'drive'] as const;
export type CopilotIndexedKind = (typeof COPILOT_INDEXED_KINDS)[number];

/** `/eligible`, `/prep <company>`, `/mock <company>`, `/resume [role]`, `/plan`. */
export const COPILOT_COMMANDS = ['eligible', 'prep', 'mock', 'resume', 'plan'] as const;
export type CopilotCommand = (typeof COPILOT_COMMANDS)[number];

/** A human next step under an answer (at most two). */
export const COPILOT_HANDOFFS = ['ask_alumnus', 'drive', 'office_hours'] as const;
export type CopilotHandoffKind = (typeof COPILOT_HANDOFFS)[number];
export const COPILOT_HANDOFFS_MAX = 2;

/** Why an answer is a refusal instead (E2: cite or refuse). */
export const COPILOT_REFUSALS = ['not_covered', 'prediction'] as const;
export type CopilotRefusal = (typeof COPILOT_REFUSALS)[number];

export const COPILOT_QUESTION_MAX = 600;
/** Numbered sources given to the model for one answer. */
export const COPILOT_SOURCES_MAX = 8;
/** The copilot's index is refreshed once a day per college, from this hour (India time). */
export const COPILOT_INDEX_HOUR_IST = 3;

/** `/prep acme labs` → { command: 'prep', arg: 'acme labs' }; anything else is a question. */
export function parseCopilotCommand(text: string): { command: CopilotCommand; arg: string } | null {
  const m = /^\/([a-z]+)\b\s*(.*)$/is.exec(text.trim());
  const command = m?.[1]?.toLowerCase() as CopilotCommand | undefined;
  if (!m || !command || !(COPILOT_COMMANDS as readonly string[]).includes(command)) return null;
  return { command, arg: (m[2] ?? '').trim().slice(0, 120) };
}

/**
 * Questions that ask for a prediction the copilot must refuse (E2): a salary or package someone
 * will get, a guarantee or the chances of being selected, admitted or placed. Deterministic,
 * English, Telugu and Hindi keywords; facts about past outcomes are still answered.
 */
export function asksForPrediction(text: string): boolean {
  const t = text.toLowerCase();
  const en =
    /\b(predict|prediction|guarantee[ds]?|guaranteed|chances?|probability|odds)\b/.test(t) ||
    /\bwill i (get|be) (selected|placed|hired|an offer|admitted|in)\b/.test(t) ||
    /\b(how much|what) (salary|ctc|package|pay|stipend)\b.*\b(will|would|can) i\b/.test(t) ||
    /\b(my|i) (will|would) (get|earn|make)\b.*\b(salary|ctc|package|lpa|lakhs?)\b/.test(t) ||
    /\bexpected (salary|ctc|package)\b/.test(t);
  // Telugu: "హామీ" (guarantee), "అవకాశాలు" (chances); Hindi: "गारंटी", "संभावना", "चांस".
  const local = /హామీ|అవకాశాలు ఎంత|गारंटी|संभावना|चांस/.test(text);
  return en || local;
}
