import { describe, expect, it } from 'vitest';
import type { SubjectView } from '@campuslink/shared';
import { citationHref, commandMatches, matchSubject, parseCommand, quizArgs, suggestionsFor } from './chat';
import { takeEvents } from './chat-stream';

describe('study chat helpers', () => {
  it('reads slash commands and their arguments', () => {
    expect(parseCommand('/videos pumping lemma')).toEqual({
      command: 'videos',
      arg: 'pumping lemma',
      unknown: null,
    });
    expect(parseCommand('/HELP')).toEqual({ command: 'help', arg: '', unknown: null });
    expect(parseCommand('/nope x')).toEqual({ command: null, arg: 'x', unknown: 'nope' });
    expect(parseCommand('What is a DFA?')).toEqual({ command: null, arg: 'What is a DFA?', unknown: null });
    expect(commandMatches('/s')).toEqual(['summary', 'syllabus', 'subject']);
    expect(commandMatches('/videos x')).toEqual([]);
    expect(quizArgs('regular languages 7')).toEqual({ topic: 'regular languages', count: 7 });
    expect(quizArgs('regular languages')).toEqual({ topic: 'regular languages', count: undefined });
  });

  it('links a citation to its page or moment with the words to highlight', () => {
    const c = { subjectId: 'S', materialId: 'M', page: 2, startSec: null };
    expect(citationHref(c, 'what is the pumping lemma')).toBe('/study/S/m/M?page=2&q=what%20pumping%20lemma');
    expect(citationHref({ ...c, page: null, startSec: 75.6 }, 'ab')).toBe('/study/S/m/M?t=75');
  });

  it('finds a subject by code or name, and suggests questions', () => {
    const list = [
      { id: '1', code: 'CS301', name: 'Formal Languages and Automata Theory' },
      { id: '2', code: 'CS302', name: 'Compilers' },
    ] as SubjectView[];
    expect(matchSubject(list, 'cs302')?.id).toBe('2');
    expect(matchSubject(list, 'automata')?.id).toBe('1');
    expect(matchSubject(list, 'physics')).toBeNull();
    expect(suggestionsFor(['DFA', 'NFA', 'Pumping lemma']).map((s) => s.kind)).toEqual([
      'explain',
      'explain',
      'videos',
      'quiz',
    ]);
  });

  it('splits server-sent events across chunk boundaries', () => {
    const one = takeEvents('event: delta\ndata: {"type":"delta","text":"a"}\n\nevent: del');
    expect(one.events).toEqual([{ type: 'delta', text: 'a' }]);
    const two = takeEvents(`${one.rest}ta\ndata: {"type":"delta","text":"b"}\n\n`);
    expect(two).toEqual({ events: [{ type: 'delta', text: 'b' }], rest: '' });
  });
});
