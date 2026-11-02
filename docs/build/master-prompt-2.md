You are the principal engineer on the CampusLink monorepo. Run this prompt only after Prompt 1 (docs/build/master-prompt-1.md) is Done in docs/build/progress.md. Deployment and infrastructure remain out of scope.

Prompt 1 made CampusLink production-complete for one college. This prompt makes it the product students open every week and alumni answer, the one that grows from college to college on its own and gets harder to replace every year it runs. The goal is the bar YC and Tier-3 colleges both care about: measurable placement outcomes, weekly habit, and a data advantage nobody else has.

Step 0: Set up
Read docs/build/progress.md, docs/build/facts.md and docs/build/report-1.md. Do not re-audit the codebase. Facts from Prompt 1 §2 still hold, as amended in facts.md; §2 below adds only what this prompt needs. Where a fact is wrong, fix facts.md and continue.
Save this prompt verbatim to docs/build/master-prompt-2.md. Add phases G1–G13 to docs/build/progress.md. Commit and push.
Work rules are those of Prompt 1 §3: the gate per phase, isolation, privacy and permission tests, three locales, primitives only, initial JS ≤ 170 KB, a spec in docs/specs/ per phase, and the revamp's binding design rules (type scale, 44 px targets, Sheet/Dialog, celebrations only at ADR 0008 moments, lazy locales, palette colours). They are not repeated here.
1. Decisions already made (do not re-open)
E1. One AI layer. Every new AI feature goes through a shared AiTasksService (G1) built on the existing providers in modules/study/ai/, the same budgets, the breaker, redactPersonal() and neutraliseInstructions(). No feature calls a provider directly.
E2. Cite or refuse. Career answers follow the study assistant's rule: answer only from retrieved, numbered sources; otherwise say what is not covered and offer a human (alumnus or TPO). Never invent companies, salaries, cut-offs, questions or people.
E3. Voice is optional, text is complete. Every voice feature has a text path. Audio is transcribed through the existing transcription providers (WHISPER_URL first) and is deleted after transcription unless the member keeps it.
E4. Public pages are opt-in, per page, revocable, and never show contact details, exact CTC, or anything about a minor.
E5. Cross-college and employer features (G12) are tenancy-sensitive. Write the next free ADR first (planned as 0013), then stop and send me the ADR and a threat-model update for approval before writing G12 code.
E6. No third-party trackers, no ads, no selling data, ever. Employer access (G12) is to students who opted in, through the college.
E7. Prompt 1's D10 still applies (stop before changes to tokens, tenancy enforcement, encryption, or new third parties holding personal data).
2. Additional verified facts (commit cc965b1; also re-check facts.md)
Study AI internals (reuse them; do not fork them)

modules/study/chat/prompt.ts exports:
redactPersonal(text);
systemPrompt(task, mode, language);
sourcesBlock(sources);
buildMessages(opts);
stripTags;
detectLanguage(text) → 'en'|'te' (Hindi from Prompt 1 B12 must already be added here; check).
modules/study/extract/chunker.ts exports neutraliseInstructions().
RetrievalService.retrieve(viewer, input) and .search(...) are in modules/study/retrieval.service.ts; hybrid search goes through VectorIndex (modules/study/vector/).
ChatService streams over POST /study/chat with server-sent events (stream: true route).
lib/text.ts exports modelText() and plainText().
Transcription: modules/study/media/transcribe.ts exports the TranscriptionProvider interface, WhisperServiceTranscriber and OpenAiTranscriber. Media tools run only in the worker (PROCESS_ROLE=worker).

Sessions and feedback: the sessions module stores SessionFeedback (unique per booking), and SESSION_TYPES includes mock_interview and resume_review. Prompt 1 B5 added public reviews.

Gamification: BADGES and XP_RULES are in packages/shared/src/schemas/gamification.ts; award only through lib/awards.ts. apps/web/src/lib/impact-card.ts already renders a downloadable mentor impact card.

Events: office_hours and ama are event kinds that alumni can host (HOSTED_KINDS); RSVPs have a waitlist and check-in.

Q&A and feed: modules/qa/ holds moderated questions and answers; modules/feed/ holds posts (with Prompt 1 B6 audiences), comments, reactions, polls and stories.

Placements (from Prompt 1 B7/B8): the PlacementDrive, DriveRegistration, Offer, AcademicRecord, HigherStudy, ExamQualification and Venture models; checkEligibility(); report definitions.

Product events (from Prompt 1 B9): the ProductEvent closed list. Add new event names to it for every feature here.

Context helpers: withPlatformScope(reason, fn) is in lib/context.ts, and backgroundAuth() in modules/users/users.service.ts. Public routes exist already (13 of them, for example GET /tenant/manifest.webmanifest).

Libraries:

already in the API: pdf-lib, qrcode, sharp, jose, undici;
added in Prompt 1: write-excel-file;
the web has lucide-react, radix-ui, @tanstack/react-virtual, cmdk and katex (lazy).
3. Phase map
Phase	Name	Group
G1	AiTasksService: the shared AI layer	Foundation
G2	Resume builder, ATS check and alumni review	Career readiness
G3	AI mock interviews (text and voice) with human follow-up	Career readiness
G4	Aptitude and coding practice	Career readiness
G5	Readiness score and the TPO readiness board	Career readiness
G6	Alumni engagement: micro-asks, office hours, recognition, giving, LinkedIn import, batch pages	Supply and habit
G7	Habit loops: weekly Next Step, peer mentors and Senior Buddy, circles, study groups, voice Q&A	Habit
G8	Growth loops: invites, public pages, college outcomes page, Campus Captains, referral outcomes, parent digest	Growth
G9	Reach: Android app, single sign-on, calendar feed, scheduled roster sync	Reach
G10	The moat data: Placement Graph, Interview Experience Bank, outcome-proven matching	Moat
G11	Career Copilot	Moat and wow
G12	The network: cross-college alumni, recruiter portal, verified credentials (stop for ADR approval first)	Network effects and revenue
G13	Re-audit, YC metrics pack and final report	Finish
4. Phases
G1. AiTasksService: the shared AI layer
Goal: every AI feature in this prompt is a few lines of task definition, with budgets, safety and metering built in.

Touches: new apps/api/src/modules/ai-tasks/, modules/study/ai-settings.service.ts, ai-usage.service.ts, packages/shared/src/constants/study.ts, app.ts.

AiTasksService.run(viewer, task, input). A task is {id, feature (AiUsage feature), tier: 'fast'|'deep', system, buildUser(input) → string, output: ZodSchema, maxTokens}. It:
resolves the provider through AiSettingsService.runtime() (college key, or the platform default from Prompt 1 B11);
picks the model by tier (DEFAULT_CHAT_MODEL or DEEP_CHAT_MODEL);
runs member text through redactPersonal() and any document text through neutraliseInstructions();
wraps user-provided material in tagged blocks the same way sourcesBlock does;
calls guardedChat;
parses JSON output with the Zod schema, with one repair retry;
records usage with the feature;
falls back to a non-AI result or a clear "not available right now" when budgets or the breaker say no, never a raw error.
AiTasksService.stream(...) does the same for streaming tasks (reuse the server-sent-events pattern of POST /study/chat).
Per-feature daily limits per member live in config (AI_FEATURE_LIMITS in shared), applied in one place.
Add an injection test suite for tasks (copy test/study-injection.test.ts): hostile resumes, job descriptions and answers.
Done when: G2–G5 and G11 use only this service. Usage by feature appears in Admin › AI and in billing.

G2. Resume builder, ATS check and alumni review
Goal: every final-year has a clean, ATS-friendly resume reviewed by an alumnus, and drives use it in one tap.

Touches: new modules/resumes/, modules/files/ (new purpose resume_pdf), modules/placements/ (registration attaches the resume), modules/mentorship/ (the resume_review session type), new apps/web/src/features/resume/.

Data: Resume {userId, title, content (JSON Resume-compatible schema: basics, education, work, projects, skills, certificates, awards), template: 'classic'|'compact', version, pdfFileId?, atsReport?}. Multiple resumes per member (for example "Core IT" and "Analyst").

Editor

A form editor with live preview, prefilled from profile, academics and roadmap certificates.
Bullet suggestions ("start with a verb, add a number") work offline with simple rules.
The AI rewrite (AiTasksService, deep) returns three alternatives per bullet, keeps the facts the member wrote, never adds new achievements, and shows a diff.
PDF

Rendered server-side in the worker with pdf-lib and the self-hosted fonts.
Single column, real text (selectable), no tables or images: the shape that applicant tracking systems parse reliably.
Stored as resume_pdf; regenerated on change.
ATS check

An atsReport with:

parseability: rule checks (sections present, contact line, dates, length ≤ 2 pages, no images);
keyword coverage against a job description the member pastes or a drive's role: deterministic keyword extraction plus an AI-summarised gap list.
Give a score out of 100 with the reasons. Never claim to predict any specific company's system.

Alumni review

"Ask an alumnus to review" creates a resume_review mentorship request with the PDF attached (or a micro-ask from G6). Reviewers comment per section; comments are stored and moderatable.

Placement link: drive registration (Prompt 1 B7) offers "attach my resume" with the latest PDF.

Events: resume_created, resume_reviewed, ats_checked.

Tests:

PDF text extraction round-trip (parse your own PDF with pdfjs-dist and find every field);
the AI rewrite never introduces a number that was not in the input (a property test with the mock provider);
isolation;
privacy export (PDF included) and erasure.
G3. AI mock interviews with human follow-up
Goal: a final-year can practise an interview at 11 pm in their language, get honest feedback, then book a human mock.

Touches: new modules/interviews/, modules/ai-tasks/, modules/study/media/transcribe.ts (reuse), modules/mentorship/ (mock_interview), features/interviews/.

Setup: the member picks a track (HR, technical for their branch, or a specific drive's role), difficulty, language (en, te, hi, or code-mixed) and mode (text or voice).

Questions

Drawn from a curated bank (InterviewQuestion {track, branch?, topic, text, rubric, source: faculty|alumni|interview_bank (G10)|ai_generated, reviewedBy?}).
AI-generated questions need faculty review before they enter the bank.
A session is 5–8 questions, with follow-ups generated from the answer (fast tier).
Voice: the browser records with MediaRecorder (Opus/WebM, mono, low bitrate). Audio is uploaded per answer, transcribed in the worker, then deleted (E3). If voice fails, the text path takes over.

Scoring: per answer {clarity, structure (STAR for HR), correctness (technical), communication} on a 1–5 rubric with one-line evidence quotes from the transcript; the overall summary uses the deep tier. No pass/fail verdict, no claims about hiring outcomes.

Then:

"Book a human mock" opens a mock_interview request to an alumnus at the target company, or with a matching role, attaching the report if the member chooses.
Progress over time is shown per rubric dimension.
Limits: per-member daily sessions from AI_FEATURE_LIMITS; one mock costs roughly N tokens (measure it, and record it in docs/ai-assistant.md).

Events: mock_started, mock_completed, human_mock_booked.

Tests: transcripts deleted after processing, the text fallback, rubric output schema, a staff-only question review queue, isolation, privacy.

G4. Aptitude and coding practice
Goal: daily practice tied to the companies that actually visit the college.

Touches: new modules/practice/, modules/placements/ (company tags), modules/gamification/ (new XP kinds), new features/practice/.

Bank: PracticeItem {kind: mcq|numeric|output_prediction|coding, topic (quant, logical, verbal, DSA topics…), difficulty, companyTags[], text, options?, answer, explanation, source: faculty|alumni|ai_generated, reviewedBy}.

Faculty and alumni author items; AI drafts need review.
Never import copyrighted question dumps. The README for the bank says so.
Daily set: 10 items a day chosen by spaced repetition (topics the member got wrong come back), with a streak and an XP kind practice_set (cap 1 a day).

Company prep: "Preparing for <company>" bundles items tagged with that company, plus its Interview Experience Bank entries (G10).

Coding: without execution, coding uses output_prediction and MCQ. Real execution goes behind a CodeRunner adapter with disabled and judge0 implementations (self-hosted Judge0, network-isolated, with time and memory limits; the platform owner turns it on).

TPO view: topic mastery by batch (suppressed counts) to plan training sessions.

Events: practice_set_completed.

Tests: scheduling maths, answer checking, the runner adapter contract (with the stub), isolation, privacy.

G5. Readiness score and the TPO readiness board
Goal: one honest number per student that tells the student what to do next and the TPO whom to help.

Touches: new modules/readiness/, modules/placements/, modules/resumes/, modules/interviews/, modules/practice/, modules/roadmaps/, features/progress/, features/admin/.

Score (0–100): the transparent sum of weighted components, each shown with its points and the next action:

resume ATS score;
mock interview average;
practice mastery;
roadmap progress for the member's target track;
mentorship sessions done;
academic eligibility headroom (CGPA vs typical drive cut-offs from the college's own drives).
Weights live in config, editable by the college. No hidden model.

Student view: "You're at 62. Next: fix two resume issues (+6), do one mock (+5)."

TPO board:

distribution by batch and branch;
a "needs help" list: students below a threshold whose next drive closes soon (visible to TPO and faculty only);
bulk nudge (WhatsApp, within caps);
export.
Privacy: the score is never visible to other students or employers (G12 consent excepted), and is excluded for minors from any ranking.

Tests: score composition, suppression, permissions, the nudge cap.

G6. Alumni engagement
Goal: alumni say yes because asks are small, recognition is real, and their batch is there.

Touches: modules/mentorship/, modules/events/, modules/gamification/, new modules/alumni/, modules/billing/ (payment adapter), apps/web/src/lib/impact-card.ts, features/mentor/mentor-dashboard.tsx (the alumni Mentoring dashboard), features/mentorship/requests.tsx, new features/alumni/.

Micro-asks. MicroAsk {kind: review_resume|answer_question|quick_intro|feedback_on_project, fromUserId, toUserId?, audience (company/branch/topic), payload ref, status, expiresAt}.
Routed to alumni whose profile matches; at most 2 a week per alumnus; one tap from WhatsApp (Prompt 1 B3 buttons).
Completing one awards impact XP (new XP_RULES kind micro_ask_done).
Recurring office hours. Extend events: recurrence {weekly, until} for office_hours, auto-creating the next instance; members subscribe to a mentor's office hours.
Recognition. A college-signed certificate of mentorship per academic year (PDF, pdf-lib), with a public verification link (G12's verifiable-credential format once built; until then, a signed id checked by a public route), plus an "Alumni of the month" announcement template for the TPO. It shows on the Wall of Mentors.
Giving. Pledge {userId, purpose: scholarship|lab|event|general, amount, status, receiptNo}:
The college publishes funds (with targets). Alumni pledge and pay through the college's own Razorpay link or bank details: money goes to the college, never through CampusLink.
The college records receipt; CampusLink generates an acknowledgement (not a tax receipt unless the college is registered for it: a setting).
Feeds Prompt 1's NAAC alumni-contribution report (B8 definition 5).
LinkedIn import. The member uploads LinkedIn's own data export (ZIP or CSV, through lib/zip-guard.ts). Parse positions, education and skills into a preview the member confirms. No scraping, no LinkedIn API login.
Batch pages. "Class of 2018, CSE": who's here (with visibility respected), where the batch works (company counts, suppressed), reunion events, and a "find your batchmates" invite flow (G8).
Tests: ask caps, routing, recurrence, certificate verification, pledge statuses, the ZIP bomb guard, isolation and privacy for every new collection.

G7. Habit loops
Goal: a reason to come back every week, built from things students need.

Touches: modules/notifications/, modules/roadmaps/, modules/jobs/, modules/placements/, modules/qa/, new modules/circles/, modules/mentorship/, features/home/.

Weekly Next Step (Monday 7 pm local, WhatsApp template weekly_next_step, within caps; push or email otherwise). It contains:

one roadmap step;
one drive or job matching eligibility;
one alumnus to ask (from match());
the readiness delta.
Built by a weekly job per tenant with backgroundAuth(). One-tap buttons open each item.

Peer mentors and Senior Buddy (features.peerMentors):

Final-years with a verified offer (or nominated by faculty) can mentor juniors. Same request flow, with peer: true and lighter caps.
Every first-year is matched to a senior buddy in week one (by branch and language), with a 4-week checklist.
Circles.

Communities per batch, branch, club or interest: posts, Q&A and events scoped to members. Created by staff, or by students with approval.
Built on the feed (posts with an audience of a circle id) rather than a new content system.
Moderation through the existing framework.
Study groups: from a study subject, form a group of 3–6, with a shared question list and a session slot. The study assistant's /quiz can be run for the group.

Voice Q&A: ask or answer a question by voice (≤ 60 s). It is transcribed (E3), the transcript is published and editable, and the audio is kept only if the author chooses. Answers by voice show a play button with the transcript.

Events: next_step_opened, buddy_matched, circle_joined, study_group_formed, voice_question.

Tests: weekly job idempotency per week (job id includes the ISO week), circle visibility in the feed, buddy matching, transcript publishing, isolation, privacy.

G8. Growth loops
Goal: each active member brings the next one, and each college's results bring the next college.

Touches: modules/verification/ (invites), new modules/public-pages/, modules/placements/ and modules/reports/ (aggregates), modules/referrals/, modules/notifications/, new features/share/.

Invite batchmates: an alumnus sees "N of your batch aren't here yet" (roster records unclaimed) and sends a WhatsApp invite with one tap (within caps; through B4 invite links).

Public pages (E4: opt-in, revocable, no contact details or exact CTC):

achievement pages ("Placed at X", "Completed the Data Analyst roadmap", "Mentored 12 students");
mentor profiles.
Each has an Open Graph image rendered server-side with sharp, and a link back to join the college's CampusLink. Served at /{tenant}/p/{slug} through new public routes, cached, and never indexing members who did not opt in.

College outcomes page (opt-in by the college): placement % and median band by year, top recruiters, alumni at companies (counts), mentoring hours. Aggregates only, through suppress(). Admissions teams will share it; it is the best sales asset for the next college.

Campus Captains:

A capability CAMPUS_CAPTAIN (add it to CAPABILITIES) granted by admins.
Captains get an onboarding dashboard for their class (claimed vs unclaimed, from Prompt 1 B6, limited to their class), invite tools, and recognition.
No access to personal contact details beyond what the invite flow sends.
Referral outcomes: extend referrals with outcome: interview|offer|no_response|rejected reported by the student (prompted at 14 and 30 days). Referrers see "your referrals led to 3 interviews and 1 offer". This feeds outcome-proven matching (G10).

Parent digest (student-initiated, consented, revocable): a monthly WhatsApp summary in the parent's language with drive registrations, sessions attended and readiness trend. No messages, no grades unless the student includes them.

Events: invite_sent, public_page_published, public_page_viewed (aggregate only), referral_outcome_reported.

Tests: public pages are 404 when not opted in or revoked; no personal data in OG images beyond the opt-in fields; captain scoping; isolation; privacy.

G9. Reach
Goal: CampusLink is installable from the Play Store, signs in with the college's accounts, and stays in sync with the college's records.

Touches: new apps/android/ (Trusted Web Activity), deploy/nginx/ (/.well-known/assetlinks.json per host), modules/auth/ (single sign-on), modules/sessions/ and modules/events/ (calendar feed), modules/imports/ (scheduled sync).

Android app: a Trusted Web Activity built with Bubblewrap from the per-college web manifest (already served at /tenant/manifest.webmanifest).
Start with one platform app whose start screen lets the member pick their college; white-label builds per college later.
Digital Asset Links at /.well-known/assetlinks.json.
Register the package name and signature hash for WhatsApp one-tap autofill OTP templates (upgrade from Prompt 1's copy code).
Document Play Console steps in docs/android.md.
Single sign-on (per college, optional):
Google Workspace and Microsoft Entra ID through OpenID Connect (authorization code with PKCE, jose for ID-token verification, issuer and audience checks, nonce and state).
Accounts are linked by email domain in allowedEmailDomains. Roster verification still applies.
Admin roles still need TOTP.
Calendar feed: a per-member secret ICS URL (rotatable) with sessions, RSVPed events and drive deadlines, so Google and Apple calendars subscribe. Tokens are hashed at rest.
Scheduled roster sync: the existing remote import adapter (REST or Google Sheets) runs on a schedule (daily or weekly) with a dry-run diff the admin approves when more than 5% of rows change. Write docs/data-sources.md steps for common college ERPs, which usually export CSV or Sheets.
Tests: OIDC negative cases (wrong issuer, audience or nonce, an expired token), domain linking, ICS token rotation, the sync diff approval gate.

G10. The moat data
Goal: turn every season's activity into knowledge that compounds for the college and cannot be copied.

Touches: new modules/graph/, modules/placements/, modules/referrals/, modules/mentorship/, modules/qa/, new features/companies/.

Placement Graph (per college). It is computed nightly from verified offers, drives, round results, referrals with outcomes, alumni profiles (companyKey, respecting field visibility) and sessions. For each company it records:

years recruited;
branches and counts;
CTC band trend;
rounds and their pass rates (suppressed);
alumni there who mentor;
referral success rate.
Company pages show this to students ("14 seniors from your branch joined; median band 4–6 LPA; aptitude, technical, HR; 3 alumni there mentor"). Every number goes through suppress() and comes only from verified records.

Interview Experience Bank:

Structured write-ups by placed students and alumni: company, role, year, rounds, questions in their own words, tips, difficulty. College-verified authors.
Moderated (ModeratableHandler); questions flow into G3 and G4 banks after review.
Prompt every verified offer holder at 7 days: "Help your juniors: share your interview".
Outcome-proven matching: scoreMatch() gains a bounded term from outcomes: mentors whose mentees (with a similar branch and target) went on to interviews or offers, and referrers whose referrals converted. Explain it in plain words ("Helped 3 students from your branch get interviews"). Keep it deterministic and unit-tested; no black-box model.

Events: company_page_viewed, experience_shared.

Tests: graph computation on fixtures, suppression, visibility respected, moderation, matching bounds.

G11. Career Copilot
Goal: the student's 11 pm question ("Can I get into X with a 6.8 CGPA? What did seniors do?") gets a cited answer from the college's own data, then a human.

Touches: modules/ai-tasks/, modules/study/retrieval.service.ts (reuse the retrieval patterns), modules/graph/, modules/roadmaps/, modules/placements/, new features/copilot/ (or extend the Study assistant UI with a "Career" scope).

Sources (indexed per college through VectorIndex with new source kinds; access-checked on every read like study passages):
Placement Graph company summaries;
Interview Experience Bank entries;
roadmap library and college roadmaps;
drive descriptions;
the member's own resume, readiness and eligibility (private to them);
alumni mentor cards (public fields only).
Answers stream with numbered citations (reuse the study chat UI and server-sent-events format).
It refuses salary predictions, admission guarantees, or anything not in sources (E2).
Every answer ends with up to two human next steps: "Ask Rahul (works at X, replies in ~1 day)", "Book office hours", "Register for the X drive (closes Friday)".
Commands: /eligible (drives I'm eligible for), /prep <company>, /mock <company> (starts G3), /resume (starts G2 for a target), /plan (a 4-week plan from roadmap steps and practice).
Safety: the injection suite extends to every new source kind. Minors get the same copilot without personalised ranking signals. Conversations stay private to the member (as in study chat).
Events: copilot_question, copilot_handoff (a human next step clicked).

Tests: citations required, refusals, access checks per source kind, handoff links, isolation, privacy.

G12. The network (stop for approval before code)
Goal: network effects across colleges and the revenue line that makes this venture-scale. This is the only phase that crosses tenant boundaries, so it starts with a design that I approve.

Step 1: the ADR (no code yet). Write the G12 ADR "Cross-college network and employer access" and update docs/threat-model.md. Cover:

a new tenant kind: 'employer', or a platform-level employer registry (decide and justify);
every cross-tenant read as a named withPlatformScope('network:<reason>', fn) path, audited, reading only from an opt-in projection collection that holds no contact details unless the student grants them;
member consent (new purposes network_discovery and employer_visibility, version 1, opt-in, revocable, never for minors);
college consent (a college-level switch, off by default);
rate limits and abuse controls for employers (verification of the employer's domain, a GSTIN, manual approval);
what an employer sees, and what is never visible: exact CTC, phone, other offers, readiness for non-consenting students;
data residency (India).
Then stop and send me the ADR and threat-model diff.

Step 2 (after approval):

Cross-college alumni discovery: "Alumni at X across CampusLink colleges" for students whose college and themselves opted in; requests go through the alumnus's consent and existing mentorship rules; per-week caps.
Recruiter portal:
Employers post roles to selected colleges or a cluster.
Colleges approve which postings their students see; postings become drives (Prompt 1 B7) in the college.
Employers see aggregate pool sizes before shortlisting, then consenting candidates' resumes (G2) and readiness (G5).
Pricing hooks through billing (Prompt 1 B10): per posting, per drive, or per hire, configurable. Revenue share with colleges is a config field.
Verified credentials:
Offers, readiness milestones, certificates and mentorship recognition are issued as signed credentials (W3C Verifiable Credentials data model, Ed25519 signatures through jose; the issuer key per college is stored encrypted, with rotation documented).
A public verify page /{tenant}/verify/{id}.
Students share them on LinkedIn or with employers.
Tests: every cross-tenant path is named and audited and returns only consenting projections; revoking consent removes visibility within one job cycle; employer abuse limits; credential signature verification and revocation; the isolation suite extended with cross-tenant negative cases for every non-network path.

G13. Re-audit, YC metrics pack and final report
Seed: extend pnpm seed with a full demo year for both colleges: resumes, mocks, practice, readiness, micro-asks, circles, a Placement Graph with enough fictional, clearly labelled data to render, copilot sources, a public outcomes page (demo-labelled), and network data only if G12 was approved.

Re-audit the UI: run the existing audit scripts (pnpm --filter @campuslink/web audit:capture, audit:journeys, audit:extras, audit:lighthouse) and publish docs/build/after-2/ with the new screens at 360 and 1440 px, both themes, three languages. Every new screen has 0 axe violations and is within budget.

YC metrics pack: a script pnpm --filter @campuslink/api metrics:yc that, with platform scope and aggregates only, prints for any date range:

colleges live;
verified members by role;
weekly active students;
the activation funnel;
week-4 retention;
request → session conversion and median reply time;
drives run and registration rate;
verified offers per 100 final-years and the change against the college's previous year;
AI questions per active student;
WhatsApp read rate.
Write docs/build/yc-metrics.md explaining each metric and how it is computed.

Final report docs/build/report-2.md:

what shipped;
decisions and deviations;
new env vars and external registrations (Play Console, OIDC apps per college, Judge0 if used, LinkedIn export instructions for members);
the AI cost per active student per month measured on the seed;
known gaps;
what I should verify myself (a native-speaker review in Hindi and Telugu, a legal review of public pages, giving and the network, a real-device test on a low-end Android phone over 3G).
Acceptance for the whole prompt:

A student can go from "I don't know where to start" to a reviewed resume, a practised interview, a registered drive and a conversation with an alumnus at the target company, in their language, mostly from WhatsApp links.
An alumnus can help in five minutes.
A TPO can see who needs help before a drive.
The college's placement history becomes a living graph.
(If approved) employers reach consenting, ready students across colleges.
Every gate is green and the initial bundle is ≤ 170 KB.
