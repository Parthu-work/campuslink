import { PRIVACY_NOTICE_VERSION } from '@campuslink/shared';

/**
 * The privacy policy and terms (build B14): templates the platform maintains, versioned with
 * `PRIVACY_NOTICE_VERSION`, filled with the college's own details ({{placeholders}}). They follow
 * what the product does (docs/privacy.md). English is the legal reference; the Telugu and Hindi
 * versions (legal-translations.ts, prompt 1b) are served only after a native speaker's review.
 *
 * Text uses the app's markdown subset: headings (`## `), lists (`- `) and **bold**.
 */
export const LEGAL_TEMPLATE_VERSION = PRIVACY_NOTICE_VERSION;

export const LEGAL_TEMPLATES = {
  privacy: {
    title: 'Privacy policy',
    body: `**{{legalName}}** ("the college") runs {{college}} on {{app}}, a private network for its students, alumni and staff. This notice says what we collect, why, and the choices you have. It follows the Digital Personal Data Protection Act, 2023.

## Who is responsible

The college is the data fiduciary for your account on {{college}}. {{app}} runs the service for the college. The college's address: {{address}}.

## What we collect

- **Your account:** name, mobile number or email, the month you turn 18 (we keep only whether you are 18, never your birth month), your language and your sign-in security settings.
- **Your college record:** roll number, branch and graduation year, matched to the list the college holds.
- **What you add:** your profile, posts, questions and answers, messages, mentorship requests and sessions, job applications you track, roadmap progress, placement registrations and outcomes you report.
- **Usage counts:** if you allow it, your activity is counted in college-level statistics. Counts under 5 are never shown.

We do not use third-party trackers or advertising, and we never sell your data.

## Why we use it

- To run your account and show your profile to verified members of your college.
- To verify that you are a student, alumnus or staff member of the college.
- To run mentorship, placements, study material and the other features the college has turned on.
- With your consent: to suggest mentors, to send you email digests and WhatsApp updates, and to count your activity in statistics. You can change these at any time in Settings → Privacy.
- To text you (SMS) when a session is about to start or a placement drive is about to close, if WhatsApp does not reach you. Nothing else is sent by SMS. You can turn this off in Settings → Notifications.

## Who sees what

- Your contact details are private unless you choose to show them. Profile fields have their own audience.
- Messages are visible only to the two people in the conversation. The college's admins cannot read them.
- Exact salary figures on offers are seen only by you and the placement cell.
- If the college turns on the study assistant, short excerpts of course material and your questions (with phone numbers and email addresses removed) are sent to the AI provider the college chose. Your name and profile are never sent.

## Members under 18

If you are under 18, a parent or guardian confirms their consent with a code sent to the number on the college's admission record. Until you turn 18, your contact details stay private, your feed is not ranked, you are not shown on leaderboards and you are not counted in statistics.

## How long we keep it

Your account is kept while you are a member. When you delete it, it is erased after {{graceDays}} days; what you shared with others stays as "Former member". Consent records and the security audit log are kept, without your details, because the law requires them. Placement and outcome records are kept by the college in anonymised form as its institutional record.

## Your rights

You can download your data, correct your profile, withdraw a consent and delete your account in Settings. You can also write to the grievance officer below.

## Grievance officer

{{officer}}

If you are not satisfied with the answer, you may complain to the Data Protection Board of India.

*Notice version {{version}}.*`,
  },
  terms: {
    title: 'Terms of use',
    body: `These terms apply to {{college}}, the college network that **{{legalName}}** ("the college") runs on {{app}}.

## Who may use it

Students, alumni and staff of the college whose place on the college's records has been verified. One account per person. Keep your sign-in details to yourself.

## How to behave

- Be truthful about who you are and what you have done.
- Be respectful. No harassment, hate, spam, scams or sexual content.
- Share only what you have the right to share. Course material you upload must be yours to share with students of the college.
- Do not share other people's personal details, and do not ask members for money.
- Do not try to break, scrape or overload the service.

Moderators may remove content that breaks these rules. You will see the reason, and you can appeal once; another moderator decides.

## Mentorship, referrals and placements

Mentors and alumni help voluntarily and decide whether to accept a request. A referral is not a job offer. Placement drives are run by the college's placement cell; eligibility follows the college's published rules.

## The study assistant

Answers are generated by AI from your college's material and may contain mistakes. Check the sources it cites.

## Your content

You keep the rights to what you post. You allow the college and {{app}} to show it to the audience you chose, for as long as it is on the service.

## Changes and contact

When these terms change, you will be asked to accept the new version on your next sign-in. Questions go to the grievance officer:

{{officer}}

*Terms version {{version}}.*`,
  },
} as const;
