import { z } from 'zod';
import { objectId } from './common.js';
import {
  COPILOT_HANDOFFS,
  COPILOT_QUESTION_MAX,
  type CopilotCommand,
  type CopilotHandoffKind,
  type CopilotRefusal,
  type CopilotSourceKind,
} from '../constants/copilot.js';

/**
 * The Career Copilot (prompt 2, G11): answers only from the college's own numbered sources, with
 * citations, or says what is not covered (E2); every answer ends with up to two human next steps.
 * Conversations are the member's own.
 */

export const copilotAskBody = z.strictObject({
  question: z.string().trim().min(2).max(COPILOT_QUESTION_MAX),
  sessionId: objectId.optional(),
});
export type CopilotAskInput = z.input<typeof copilotAskBody>;
export const copilotSessionParams = z.strictObject({ id: objectId });
export const copilotHandoffBody = z.strictObject({
  messageId: objectId,
  kind: z.enum(COPILOT_HANDOFFS),
});

/** A numbered source an answer cites; `href` opens it in the app. */
export interface CopilotCitation {
  n: number;
  kind: CopilotSourceKind;
  title: string;
  href: string;
  snippet: string;
}

/** A human next step: who or what, and where it opens. Names and times only, never message text. */
export interface CopilotHandoff {
  kind: CopilotHandoffKind;
  href: string;
  /** ask_alumnus: name and company; drive: company and title; office_hours: the event title. */
  name: string;
  detail: string;
  /** ask_alumnus: median reply in hours; drive: registration closes; office_hours: starts. */
  replyHours?: number | null;
  at?: string | null;
}

/** Structured results the web words itself (commands, refusals, the no-AI answer). */
export type CopilotResult =
  | { kind: 'refusal'; reason: CopilotRefusal }
  /** No AI right now: the best sources themselves, cited. */
  | { kind: 'sources_only' }
  | {
      kind: 'drives';
      drives: { id: string; company: string; title: string; closesAt: string }[];
    }
  | {
      kind: 'link';
      command: Exclude<CopilotCommand, 'eligible' | 'plan'>;
      href: string;
      company: string | null;
    }
  | {
      kind: 'plan';
      weeks: {
        week: number;
        items: { kind: 'roadmap' | 'practice' | 'mock' | 'mentor'; title: string; href: string }[];
      }[];
    };

export interface CopilotMessageView {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  command: CopilotCommand | null;
  citations: CopilotCitation[];
  handoffs: CopilotHandoff[];
  result: CopilotResult | null;
  status: 'streaming' | 'done' | 'failed';
  createdAt: string;
}
export interface CopilotSessionView {
  id: string;
  title: string;
  lastMessageAt: string;
  messageCount: number;
}
export interface CopilotSessionDetail extends CopilotSessionView {
  messages: CopilotMessageView[];
}
/** What the copilot screen needs up front. */
export interface CopilotHomeView {
  sessions: CopilotSessionView[];
  /** The member's questions left today (AI_FEATURE_LIMITS.copilot), or null when AI is off. */
  left: number | null;
  /** AI answers are available; without them the copilot still shows its sources. */
  ai: boolean;
}

/** The server-sent events of one question (POST /copilot/chat), as the study assistant's. */
export type CopilotStreamEvent =
  | { type: 'start'; sessionId: string; question: CopilotMessageView; messageId: string }
  | { type: 'sources'; citations: CopilotCitation[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; message: CopilotMessageView }
  | { type: 'error'; code: string; message: string };
