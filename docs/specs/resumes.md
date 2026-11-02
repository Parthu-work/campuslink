# Résumés: builder, ATS check and alumni review (prompt 2, G2)

Goal: every final-year has a clean résumé that applicant tracking systems read, reviewed by an alumnus, and drives take it in one tap.

## Data

`modules/resumes/resume.model.ts`, tenant models (indexes lead with `tenantId`):

| Collection       | Fields                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `resumes`        | `userId`, `title`, `template` (`classic`, `compact`), `content`, `version`, `pdfFileId`, `pdfVersion`, `pages`, `atsReport`, timestamps  |
| `resumecomments` | `resumeId`, `authorId`, `section` (a content section or `general`), `body`, `resumeVersion`, `status` (`visible`, `removed`), timestamps |

`content` is a JSON Resume-compatible subset (`resumeContent` in `packages/shared/src/schemas/resumes.ts`): basics (name, headline, email, phone, city, summary, up to four https profile links), education, work, projects, skills, certificates, awards. Dates are `YYYY` or `YYYY-MM`; an empty end date means "present". A member keeps at most five résumés (`RESUMES_PER_MEMBER`).

**The résumé itself is English.** Every text field refuses Devanagari and Telugu script: applicant tracking systems read English, and the PDF font (Noto Sans, Latin) is chosen for them. The screens around it are in all three languages.

## Permissions

- `resumes:manage` (students; alumni inherit it): list, create, edit, delete, check, rewrite.
- Reading a résumé, its PDF and its comments, and commenting: the owner, or a member with a `resume_review` mentorship request about that résumé that is pending or accepted (`RequestsService.reviewsResume`). Anyone else gets 404, never 403, so a résumé's existence is not revealed.
- Staff do not hold `resumes:manage`. The placement cell sees only the copy a student attaches to a drive.

## API

| Route                            | What                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /resumes`                   | my résumés (summary with the last check score)                                            |
| `GET /resumes/prefill`           | a draft from the profile (`profile.fields`), the academic record and finished roadmaps    |
| `POST /resumes`                  | create (idempotent); prefilled unless `content` is sent                                   |
| `GET /resumes/:id`               | owner or reviewer; `mine` says which                                                      |
| `PUT /resumes/:id`               | save with the `version` the edit started from; a stale save is 409 and overwrites nothing |
| `DELETE /resumes/:id`            | the résumé, its PDF and its comments (copies attached to drives stay with the drive)      |
| `GET /resumes/:id/pdf`           | owner or reviewer; `Cache-Control: private, no-store`                                     |
| `POST /resumes/:id/ats`          | the check; optional `jobDescription` (pasted) or `driveId`, not both                      |
| `POST /resumes/:id/rewrite`      | three tighter versions of one saved bullet (`section`, `entry`, `bullet`)                 |
| `GET/POST /resumes/:id/comments` | owner or reviewer; posting notifies the owner (`resume_comment`) and is moderatable       |

Changed elsewhere: mentorship requests take an optional `resumeId` (only with `sessionType: resume_review`, and only the mentee's own résumé); drive registration takes `resumeId` as well as `resumeFileId`; files have a new purpose `resume_pdf`.

## PDF

`resume-pdf.ts` draws with pdf-lib and the self-hosted Noto Sans (regular and bold): A4, one column, real text with an embedded subset font, no tables or images. Each save queues `resumes.render` on the worker (job id `resume-<id>-v<version>`, so a double save renders once); the PDF is stored as one `resume_pdf` file that is replaced, never accumulated. Reads render on demand when the stored PDF is older than the résumé.

## ATS check

A guide to a readable résumé, never a claim about any employer's system (the screen says so).

- **Parseability, 60 points**: name, contact, education, skills, experience or projects, dates in one style, one or two pages, text only, bullets that start with what was done. Each check has its points and what it earned.
- **Keywords, 40 points**, when a job description is pasted or a drive is picked: deterministic extraction (`ats.ts`: tech tokens kept, filler and stop words dropped, recurring phrases preferred), then coverage of the résumé text. Without a role, parseability is scaled to 100.
- **Gaps**: up to five short gaps from `gapsTask` (fast tier) over both texts; when AI is off or fails, the missing keywords themselves ("Show X if you have used it").
- The last report is stored on the résumé with the version it read; the screen marks it "from an older version" after an edit.

## Rewrites

`rewriteTask` (deep tier) returns up to three alternatives for one bullet. The system prompt forbids new numbers, tools, results or achievements; the service drops any alternative that adds a number the bullet did not have (`addsNumbers`). Offline, or when the model fails, rule-based rewrites (`ruleRewrites`) and tips (`bulletTips`: start with a verb, keep it under two lines, add a number if you have one) are returned with `source: 'rules'`. The sheet shows each suggestion with its new words highlighted (`word-diff.ts`).

## Screens

- **Résumé** (`/resume`, the "you" menu, `resumes:manage`): up to five, each with its layout, last edit and check score; "New résumé" names it and picks a layout, then opens the editor on the prefilled draft.
- **Editor** (`/resume/:id`, owner): tabs Edit, Preview, Check, Comments. Save is explicit (a sticky bar shows unsaved changes); the client runs the shared schema first and names the section of the first problem. "Improve" on a saved bullet opens the rewrite sheet. "Download PDF" and "Ask an alumnus to review" (the mentor list filtered to résumé reviews) sit in the header.
- **Review** (`/resume/:id`, reviewer): the preview, download, and comments by section. Opened from the request card ("Open the résumé").
- **Mentor request**: choosing "Résumé review" offers the member's résumés (or none).
- **Drive registration**: when the drive asks for a résumé, "Use a résumé you built" lists the member's résumés; picking one attaches a copy of its current PDF instead of an upload.

## Events

`resume_created`, `resume_reviewed` (a reviewer's first comment), `ats_checked`.

## Privacy

Export (`resumes`): every résumé with its content, its last check and its stored PDF as base64, and the comments the member wrote. Erasure removes the member's résumés, their PDFs, the comments on them, and the comments the member wrote on others' résumés.

## Tests

`apps/api/test/resumes.test.ts`: prefill; PDF text round-trip with pdfjs-dist (every field found, one column, within two pages); stale save refused, one file kept; five per member; the score with and without a role; keyword extraction; a property test that no rule or demo rewrite introduces a number; the filter on model output; the review flow (mentor reads and comments, owner notified, others 404); moderation; "attach my résumé"; cross-college isolation; export with PDF and erasure. `apps/web/src/features/resume/word-diff.test.ts`; `apps/web/e2e/resumes.spec.ts` (build, save, preview, check, download, delete; axe on each screen).
