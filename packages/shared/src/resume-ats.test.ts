import { describe, expect, it } from 'vitest';
import { atsScore, atsScoreFor, extractKeywords } from './resume-ats.js';
import type { ResumeContent } from './schemas/resumes.js';

const base: ResumeContent = {
  basics: { name: 'Ananya K', label: '', email: 'ananya@example.com', phone: '', location: '', summary: '' },
  profiles: [],
  education: [
    {
      institution: 'DPIT',
      area: 'CSE',
      studyType: 'B.Tech',
      startDate: '2023-08',
      endDate: '2027-05',
      score: '',
    },
  ],
  work: [],
  projects: [
    {
      name: 'Library app',
      description: 'A REST API in Java',
      url: '',
      highlights: ['Built a REST API serving 200 students'],
    },
  ],
  skills: [{ name: 'Languages', keywords: ['Java', 'SQL'] }],
  certificates: [],
  awards: [],
} as unknown as ResumeContent;

describe('atsScoreFor (prompt 3, U7: the live score)', () => {
  it('scores the same as atsScore for the keywords of a job description', () => {
    const jd = 'Java developer. Java, SQL and REST APIs. Spring Boot preferred. Spring Boot microservices.';
    expect(atsScoreFor(base, 1, extractKeywords(jd))).toEqual(atsScore(base, 1, jd));
  });

  it('rises as the member adds a missing keyword', () => {
    const keywords = ['java', 'docker'];
    const before = atsScoreFor(base, 1, keywords);
    expect(before.missing).toEqual(['docker']);
    const after = atsScoreFor(
      { ...base, skills: [{ name: 'Languages', keywords: ['Java', 'SQL', 'Docker'] }] },
      1,
      keywords,
    );
    expect(after.missing).toEqual([]);
    expect(after.score).toBeGreaterThan(before.score);
  });

  it('without keywords, is the parseability scaled to 100', () => {
    const r = atsScoreFor(base, 1, null);
    const earned = r.checks.reduce((n, c) => n + c.earned, 0);
    expect(r.score).toBe(Math.round((earned / 60) * 100));
  });
});
