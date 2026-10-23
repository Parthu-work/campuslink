/**
 * DEMO study data for `pnpm seed` (spec §11): the FLAT subject (Formal Languages and Automata
 * Theory) with a syllabus tree, three short notes written for this demo, and a synthetic sample
 * video (colour bars, no sound) whose transcript is a short self-written lesson. Everything is
 * labelled as demo; no textbook or third-party material is included. The built-in demo assistant
 * and demo embeddings are switched on, so upload → index → ask → cite → /videos works with no key.
 */
import { readFileSync } from 'node:fs';
import type { Types } from 'mongoose';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { Env } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { MemoryMailProvider } from '../lib/mailer.js';
import { InlineJobQueue } from '../lib/jobs.js';
import { storageFromEnv } from '../lib/storage-factory.js';
import { createApp } from '../app.js';
import { findTenantById } from '../modules/tenants/tenant.cache.js';
import { backgroundAuth } from '../modules/users/users.service.js';
import { AiSettingsModel } from '../modules/study/ai-settings.model.js';
import type { SubjectsService } from '../modules/study/subjects.service.js';
import type { MaterialsService } from '../modules/study/materials.service.js';

const SYLLABUS = [
  {
    title: 'Finite Automata',
    topics: [
      { title: 'Alphabets, strings and languages', keywords: ['alphabet', 'string', 'language'] },
      { title: 'Deterministic finite automata', keywords: ['dfa', 'deterministic'] },
      { title: 'Nondeterministic finite automata', keywords: ['nfa', 'nondeterministic'] },
      { title: 'Equivalence of NFA and DFA', keywords: ['subset construction'] },
    ],
  },
  {
    title: 'Regular Expressions and Regular Languages',
    topics: [
      { title: 'Regular expressions', keywords: ['regex', 'kleene star'] },
      { title: "Kleene's theorem", keywords: ['kleene'] },
      { title: 'Pumping lemma for regular languages', keywords: ['pumping'] },
    ],
  },
  {
    title: 'Context-Free Grammars',
    topics: [
      { title: 'Context-free grammars', keywords: ['cfg', 'grammar', 'productions'] },
      { title: 'Derivations and parse trees', keywords: ['derivation', 'parse tree'] },
      { title: 'Ambiguity', keywords: ['ambiguous'] },
    ],
  },
  {
    title: 'Pushdown Automata',
    topics: [
      { title: 'Pushdown automata', keywords: ['pda', 'stack'] },
      { title: 'Equivalence of PDA and CFG', keywords: [] },
    ],
  },
  {
    title: 'Turing Machines',
    topics: [
      { title: 'Turing machines', keywords: ['tape'] },
      { title: 'Decidability', keywords: ['decidable', 'halting'] },
    ],
  },
];

/** Short notes written for this demo (plain ASCII: the PDF's standard font has no Greek letters). */
const NOTES: { file: string; title: string; unit: number; topics: number[]; pages: string[][] }[] = [
  {
    file: 'flat-demo-notes-1-finite-automata.pdf',
    title: 'DEMO notes 1: Finite automata',
    unit: 0,
    topics: [0, 1, 2, 3],
    pages: [
      [
        'Alphabets, strings and languages (DEMO notes)',
        'An alphabet is a finite, non-empty set of symbols, for example {0, 1}.',
        'A string over an alphabet is a finite sequence of its symbols; the empty string has length 0.',
        'A language is a set of strings over an alphabet. It may be finite or infinite.',
      ],
      [
        'Deterministic finite automata (DEMO notes)',
        'A DFA is a 5-tuple (Q, Sigma, delta, q0, F): states, alphabet, transition function,',
        'start state and accepting states. For each state and symbol there is exactly one next state.',
        'A DFA accepts a string when the run that reads it ends in an accepting state.',
        'Example: two states, "even" and "odd", track the number of 0s read; the DFA that',
        'accepts binary strings with an even number of 0s makes "even" both start and accepting.',
      ],
      [
        'Nondeterministic finite automata (DEMO notes)',
        'An NFA may have several possible next states, or none, for a state and a symbol,',
        'and may have epsilon moves that read no input. It accepts when some run accepts.',
        'Every NFA can be converted to an equivalent DFA with the subset construction:',
        'each DFA state is a set of NFA states. So NFAs and DFAs accept the same languages,',
        'the regular languages, although the DFA may need up to 2^n states for an n-state NFA.',
      ],
    ],
  },
  {
    file: 'flat-demo-notes-2-regular-expressions.pdf',
    title: 'DEMO notes 2: Regular expressions and the pumping lemma',
    unit: 1,
    topics: [4, 5, 6],
    pages: [
      [
        'Regular expressions (DEMO notes)',
        'Regular expressions are built from symbols with union (+ or |), concatenation and the',
        'Kleene star (*), which means zero or more repetitions. Example: (0+1)*1 is every',
        'binary string that ends in 1.',
        "Kleene's theorem: a language is described by a regular expression exactly when some",
        'finite automaton accepts it.',
      ],
      [
        'The pumping lemma for regular languages (DEMO notes)',
        'If L is regular, there is a number p (the pumping length) such that every string s in L',
        'with length at least p can be split as s = xyz with |y| > 0 and |xy| <= p, so that',
        'x y^i z is in L for every i >= 0.',
        'It is used to show that a language is NOT regular: assume it is, pick a long string,',
        'and show that pumping leaves the language. Example: {0^n 1^n : n >= 0} is not regular.',
      ],
    ],
  },
  {
    file: 'flat-demo-notes-3-context-free-grammars.pdf',
    title: 'DEMO notes 3: Context-free grammars',
    unit: 2,
    topics: [7, 8, 9],
    pages: [
      [
        'Context-free grammars (DEMO notes)',
        'A context-free grammar is a 4-tuple (V, T, P, S): variables, terminals, productions',
        'and a start variable. Each production replaces one variable, for example S -> 0S1.',
        'The grammar S -> 0S1 | epsilon generates {0^n 1^n : n >= 0}, a context-free language',
        'that is not regular.',
      ],
      [
        'Derivations, parse trees and ambiguity (DEMO notes)',
        'A derivation applies productions one at a time; a leftmost derivation always replaces',
        'the leftmost variable. A parse tree shows a derivation without its order.',
        'A grammar is ambiguous when some string has two different parse trees. Pushdown',
        'automata (a finite automaton with a stack) accept exactly the context-free languages.',
      ],
    ],
  },
];

/** The demo video's transcript: a short lesson written for this demo (the picture is colour bars). */
const VTT = `WEBVTT

00:00:00.000 --> 00:00:08.000
DEMO lesson: converting a nondeterministic finite automaton, an NFA, into a deterministic one, a DFA.

00:00:08.000 --> 00:00:16.000
An NFA may have several possible next states for a state and an input symbol, or none at all.

00:00:16.000 --> 00:00:24.000
It accepts a string when at least one of its possible runs ends in an accepting state.

00:00:24.000 --> 00:00:32.000
The subset construction builds a DFA in which every state stands for a set of NFA states.

00:00:32.000 --> 00:00:40.000
The start state of the DFA is the set of NFA start states, together with everything reachable from them by epsilon moves.

00:00:40.000 --> 00:00:48.000
For each set and each input symbol, the next DFA state is the set of every NFA state reachable on that symbol.

00:00:48.000 --> 00:00:56.000
We repeat this for every new set we find, until no new sets appear. There are at most two to the power n sets.

00:00:56.000 --> 00:01:04.000
A set is an accepting state of the DFA when it contains at least one accepting NFA state.

00:01:04.000 --> 00:01:12.000
The DFA reads each string exactly the way the NFA could, so both accept the same language.

00:01:12.000 --> 00:01:20.000
That is why NFAs and DFAs describe the same class of languages: the regular languages.

00:01:20.000 --> 00:01:28.000
Regular expressions describe this class too, by Kleene's theorem.

00:01:28.000 --> 00:01:36.000
To show that a language is not regular, use the pumping lemma for regular languages. End of the demo lesson.
`;

async function pdf(pages: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle('DEMO study notes');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const p = doc.addPage([595, 842]);
    lines.forEach((line, i) =>
      p.drawText(line, { x: 48, y: 780 - i * 24, size: i === 0 ? 18 : 11, font, maxWidth: 500 }),
    );
  }
  return Buffer.from(await doc.save());
}

/** The services the demo material goes through (the real upload and processing pipeline). */
export function studySeeder(env: Env) {
  const jobs = new InlineJobQueue();
  const app = createApp({
    env,
    logger: createLogger('silent'),
    readiness: {},
    mailer: new MemoryMailProvider(),
    jobs,
    storage: storageFromEnv(env).storage,
  });
  const services = app.locals.services as { subjects: SubjectsService; materials: MaterialsService };

  /** Seeds the FLAT demo in the current college (call inside its tenant context). */
  return async function seedStudy(
    tenantId: Types.ObjectId,
    facultyId: Types.ObjectId,
    opts: { material: boolean },
  ) {
    const tenant = await findTenantById(tenantId);
    const viewer = tenant && (await backgroundAuth(facultyId, tenant));
    if (!tenant || !viewer) throw new Error('Study seed: the demo faculty member is missing');
    const meta = { requestId: 'seed' };
    // The built-in demo assistant and demo embeddings: no key, nothing leaves the machine.
    await AiSettingsModel.updateOne(
      {},
      {
        $set: {
          chatProvider: 'mock',
          chatModel: 'mock-chat-1',
          embeddingProvider: 'mock',
          embeddingModel: 'mock-embed-1',
          'features.chatbot': true,
        },
      },
      { upsert: true },
    );
    const subject = await services.subjects.create(
      viewer,
      tenant,
      {
        name: 'Formal Languages and Automata Theory (DEMO)',
        code: 'FLAT',
        branches: [],
        batches: [],
        semester: null,
        regulation: 'DEMO',
        description:
          'DEMO subject: a sample syllabus, short notes written for this demo and a synthetic sample video, for trying the library and the study assistant.',
        ownerIds: [],
      },
      meta,
    );
    const tree = await services.subjects.saveSyllabus(viewer, subject.id, { units: SYLLABUS });
    if (!opts.material) return;
    const topicIds = tree.units.flatMap((u) => u.topics.map((t) => t.id));
    for (const n of NOTES) {
      const unit = tree.units[n.unit];
      await services.materials.upload(
        viewer,
        {
          subjectId: subject.id,
          title: n.title,
          description: 'DEMO notes written for this sample subject.',
          unitId: unit?.id ?? '',
          topicIds: n.topics.map((i) => topicIds[i]).filter((x): x is string => !!x),
          language: 'en',
          rights: 'true',
        },
        { buffer: await pdf(n.pages), originalname: n.file },
        meta,
      );
    }
    const video = await services.materials.upload(
      viewer,
      {
        subjectId: subject.id,
        title: 'DEMO video: NFA to DFA (subset construction)',
        description:
          'DEMO: a synthetic picture (colour bars) with a short self-written lesson as its transcript.',
        unitId: tree.units[0]?.id ?? '',
        topicIds: [topicIds[3], topicIds[2]].filter((x): x is string => !!x),
        language: 'en',
        rights: 'true',
      },
      {
        buffer: readFileSync(new URL('./seed-assets/flat-demo-video.mp4', import.meta.url)),
        originalname: 'flat-demo-video.mp4',
      },
      meta,
    );
    await jobs.drain();
    if (!video) throw new Error('Study seed: the demo video was not stored');
    // Chapters give the lesson its sections (and /videos one moment per section).
    await services.materials.update(viewer, video.id, {
      chapters: [
        { at: 0, title: 'What an NFA is' },
        { at: 24, title: 'The subset construction' },
        { at: 64, title: 'Why it matters' },
      ],
    });
    await services.materials.setTranscript(viewer, video.id, { buffer: Buffer.from(VTT) }, meta);
    await jobs.drain();
  };
}
