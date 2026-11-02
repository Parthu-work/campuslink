import { describe, expect, it } from 'vitest';
import { atsCheckBody, resumeContent } from './schemas/resumes.js';

/** Prompt 2, G2: the résumé itself is English; the screens around it are translated. */
describe('résumé content', () => {
  it('refuses Telugu and Devanagari script and accepts English, numbers and punctuation', () => {
    expect(resumeContent.safeParse({ basics: { name: 'అనన్య' } }).success).toBe(false);
    expect(resumeContent.safeParse({ basics: { name: 'अनन्या' } }).success).toBe(false);
    const ok = resumeContent.safeParse({
      basics: { name: 'Ananya Reddy', summary: 'Python, Spring Boot & SQL; 8.4 CGPA (2026).' },
    });
    expect(ok.success).toBe(true);
  });

  it('takes YYYY or YYYY-MM dates and https profile links only', () => {
    const entry = (startDate: string) =>
      resumeContent.safeParse({ basics: { name: 'A' }, education: [{ institution: 'X', startDate }] })
        .success;
    expect(entry('2024')).toBe(true);
    expect(entry('2024-06')).toBe(true);
    expect(entry('06/2024')).toBe(false);
    expect(entry('2024-13')).toBe(false);
    const link = (url: string) =>
      resumeContent.safeParse({ basics: { name: 'A', profiles: [{ network: 'GitHub', url }] } }).success;
    expect(link('https://github.com/a')).toBe(true);
    expect(link('http://github.com/a')).toBe(false);
  });

  it('a check is against a pasted description or a drive, not both', () => {
    expect(atsCheckBody.safeParse({ jobDescription: 'Java', driveId: 'a'.repeat(24) }).success).toBe(false);
    expect(atsCheckBody.safeParse({ driveId: 'a'.repeat(24) }).success).toBe(true);
  });
});
