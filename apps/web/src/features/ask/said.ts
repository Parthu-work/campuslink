import { parseCopilotCommand, type CopilotCommand } from '@campuslink/shared';
import type { TFunction } from '../../i18n/core';
import { parseCommand } from '../../lib/chat';

/**
 * A command a member sent, in words (prompt 3, U8): "/quiz arrays" reads back as "Quiz me on
 * arrays", "/eligible" as "Which drives can I register for?". Commands still work when typed;
 * they are never shown back as syntax. Anything that is not a command is returned as written.
 */
export function studySaid(t: TFunction, text: string): string {
  const { command, arg } = parseCommand(text);
  if (!command) return text;
  const a = arg.trim();
  if (command === 'subject') return a ? t('ask.said.subject', { arg: a }) : t('ask.said.subjectAll');
  if (command === 'help' || command === 'syllabus') return t(`ask.said.${command}`);
  return a ? t(`ask.said.${command}`, { arg: a }) : t(`ask.said.${command}Any`);
}

export function careerSaid(t: TFunction, text: string): string {
  const c = parseCopilotCommand(text);
  if (!c) return text;
  return careerCommandText(t, c.command, c.arg);
}

export function careerCommandText(t: TFunction, command: CopilotCommand, arg: string): string {
  const a = arg.trim();
  switch (command) {
    case 'eligible':
    case 'plan':
      return t(`ask.said.${command}`);
    case 'resume':
      return a ? t('ask.said.resumeFor', { arg: a }) : t('ask.said.resume');
    case 'prep':
    case 'mock':
      return a ? t(`ask.said.${command}`, { arg: a }) : t(`ask.said.${command}Any`);
  }
}
