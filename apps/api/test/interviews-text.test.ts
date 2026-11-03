import { beforeAll, describe, expect, it } from 'vitest';
import type { InterviewHistoryView, InterviewView } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';

/**
 * Prompt 2, G3 (E3): a college with no AI and no transcription service. Voice is unavailable, so a
 * voice session runs as text, and every answer is kept, unscored, with a rules summary. Its own app
 * (no Whisper): a second app in one test file shares state the analytics tests rely on.
 */
const ctx = testApp({ whisper: null });
let U: TestTenant;
const q = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const recording = (speech: string) =>
  Buffer.concat([
    Buffer.from([
      0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04,
      0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x04, 0x42, 0x85,
      0x81, 0x02,
    ]),
    Buffer.from(speech),
  ]);
const LONG =
  'In my third year our project team missed a demo deadline. My task was the backend. I decided to split the work into daily goals, I fixed the failing database queries myself, and as a result we shipped the demo two days later and I learned to raise problems early.';

beforeAll(async () => {
  U = await makeTenant('interviewsq');
});

describe('the text path (prompt 2, G3)', () => {
  it('without AI or a transcription service everything still works in text, unscored', async () => {
    const fu = await makeUser(ctx, U, { roles: ['STUDENT'] });
    const h = (await q(fu).get('/interviews')).body.data as InterviewHistoryView;
    expect(h.voiceAvailable).toBe(false);
    const s = (await q(fu).post('/interviews').send({ track: 'hr', mode: 'voice', questions: 5 })).body
      .data as InterviewView;
    expect(s.mode).toBe('text');
    expect(
      (
        await q(fu)
          .post(`/interviews/${s.id}/turns/0/audio`)
          .attach('audio', recording(LONG), { filename: 'a.webm', contentType: 'audio/webm' })
      ).status,
    ).toBe(400);
    let v = s;
    while (v.current !== null) {
      const r = await q(fu).post(`/interviews/${s.id}/answers`).send({ turn: v.current, text: LONG });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      v = r.body.data as InterviewView;
    }
    expect(v.turns.every((t) => t.scores === null)).toBe(true);
    expect(v.unscored).toBe(5);
    expect(v.summary).toMatchObject({ source: 'rules', strengths: [], improve: [] });
    expect(v.summary?.overall).toMatch(/not available/);
  });
});
