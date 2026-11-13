# Hindi translation review (build B12)

All Hindi text was machine-assisted and has **not** been checked by a native speaker. Before a college uses the app in Hindi, a native Hindi speaker should review it in this order. Legal and consent texts also need a lawyer's sign-off (see `docs/privacy.md`).

## 1. Legal and consent texts (must be reviewed, and by a lawyer too)

| Where                                                                                   | What                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/modules/tenants/legal-translations.ts` (`te`, `hi`)                       | The privacy policy and terms (prompt 1b, R13). **Not served until reviewed:** set `reviewed` to the reviewer and date, bump `PRIVACY_NOTICE_VERSION`, and record the new fingerprint in `test/legal.test.ts`. Review the labels too (email, phone, the missing-officer and missing-address sentences). |
| `apps/web/src/features/guardian/declaration.ts` (`hi`)                                  | The guardian's consent declaration (DPDP Rules 2025, Rule 10). Version 1.                                                                                                                                                                                                                              |
| `apps/web/src/i18n/hi.json` › `auth.consent.*`, `auth.consentTitle`, `auth.privacyNote` | The consent choices at sign-up                                                                                                                                                                                                                                                                         |
| `hi.json` › `guardian.*`                                                                | The guardian-consent screen                                                                                                                                                                                                                                                                            |
| `hi.json` › `settings.data.*`, `settings.consentsBody`, `settings.rights`               | Data export, account deletion and consent settings                                                                                                                                                                                                                                                     |
| `hi.json` › `ai.consentTitle`, `ai.consentBody`                                         | The AI data-processing notice an admin accepts for the college                                                                                                                                                                                                                                         |

## 2. Messages sent outside the app (fixed once registered)

| Where                                                                                                                                                                     | What                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/notifications/channels/sms-templates.ts` › `otp_hi`                                                                                                 | The Hindi code SMS. Once registered on DLT the text cannot change without re-registration.      |
| `apps/api/src/modules/notifications/channels/whatsapp-templates.ts` (`hi`)                                                                                                | WhatsApp templates submitted to Meta (`docs/whatsapp-templates.md`)                             |
| `apps/api/src/modules/notifications/templates.ts` (`hi`)                                                                                                                  | Email and push notifications                                                                    |
| `sms-templates.ts` › `session_reminder_hi`, `drive_reminder_hi` (and `_te`)                                                                                               | Reminder SMS (prompt 1b, R4), Hindi and Telugu. Fixed once registered on DLT.                   |
| `whatsapp-templates.ts` › `cl_weekly_digest` (`hi`, `te`)                                                                                                                 | The weekly digest template (prompt 1b, R8), submitted to Meta                                   |
| `legal-translations.ts` › `labels.inactivePurge` (`te`, `hi`), `whatsapp-templates.ts` › `cl_account_inactive`, `hi.json` › `notify.account_inactive`, `legal.retention*` | The inactive-account purge (prompt 1b, R7): the policy sentence, the warning and the admin card |
| `hi.json` › `notifications.weeklyDigest*`, `notify.weekly_digest`                                                                                                         | The digest switch and its push and email text                                                   |
| `hi.json` › `notifications.smsReminders`, `notifications.smsRemindersBody`                                                                                                | The SMS reminders switch (prompt 1b, R4)                                                        |

## 3. High-traffic screens

`hi.json` sections in order of use: `common`, `nav`, `landing`, `auth`, `phone`, `verify`, `join`, `home`, `mentors`, `request`, `sessions`, `messages`, `placements`, `jobs`, `study`, `notify`, `notifications`.

## 4. Everything else

The remaining sections (`admin`, `platform`, `pbilling`, `billing`, `reports`, `insights`, `ai`, `roadmaps`, `mod`, `sources`, `jobSources`, `design`) are mostly used by staff, who often prefer English.

## Choices the reviewer should confirm

- **Register.** Everyday Hindi with common English loanwords students already use (मेंटर, प्लेसमेंट, ड्राइव, रिज़्यूमे, बैकलॉग, सेव, अपलोड), not Sanskritised formal Hindi. Formal terms are kept where they are standard (सत्यापन, सहमति, अभिभावक).
- **Address.** आप throughout, with plural verb forms (आप कर सकते हैं).
- **Gender.** Where the speaker's gender is unknown, a few strings use a neutral form or both forms (देता/देती हूँ in the guardian declaration). Others use the masculine default (मैं जा रहा हूँ on the RSVP button, कर सकता हूँ in referral replies); the reviewer may prefer neutral rewordings.
- **Untranslated on purpose.** Product and brand names (`{{app}}`, Alumni Match, WhatsApp, Google Sheet, Greenhouse, YouTube), exam names (GATE, CAT, UPSC), plan names (Connect, Placement) and code examples (`**bold**`, `/videos`, `21CSE117`, `UNIT I: …`).
- **Numbers and dates** are formatted by the browser for `hi-IN` (Western digits, Indian grouping: 1,20,000).
- **Plurals.** Hindi uses the same noun form for many nouns in both `_one` and `_other`; the pairs are kept so the keys match English.

## Prompt 3 (Telugu and Hindi, machine-assisted, not yet reviewed)

Every string added or changed in prompt 3, by phase. Review in the order of the list (high-traffic first).

| Phase | Where                                                                                                                                                                                              | What                                                                                                                          |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| U1    | `te.json`, `hi.json` › `ui.*`                                                                                                                                                                      | The primitives' words: About this, More actions, Filters, Clear all, Show results, Undo, countdowns, step states, See all     |
| U1    | `packs/design.te.json`, `packs/design.hi.json` › `design.v2.*`, `design.sampleHi`                                                                                                                  | The style guide's specimen text (development builds only; low priority)                                                       |
| U2    | `te.json`, `hi.json` › `nav.spaces.*`                                                                                                                                                              | The space names on the bottom tabs (high traffic: every screen). Each must fit a 72 px tab at 12.5 px; the e2e test checks it |
| U2    | `te.json`, `hi.json` › `nav.inbox*`, `nav.allIn`, `nav.youAreHere`, `nav.sectionsOf`, `nav.locked`; `palette.recent`, `palette.companies`, `palette.drives`, `palette.subjects`, `palette.actions` | The inbox, the sidebar's "All in …", breadcrumbs, the "opens after you verify" note and the search groups                     |

Short words chosen for the tabs (U2): Learn is "నేర్చుకో" (imperative, shorter than నేర్చుకోండి) and "सीखें"; You is "మీరు" and "आप". Notes for the reviewer: the countdown strings wrap the browser's own relative time (`Intl.RelativeTimeFormat`, "2 రోజుల్లో", "2 दिन में"), so `ui.closes` and `ui.starts` put `{{when}}` first in Telugu and Hindi; `ui.stepOf` reorders "Step 3 of 10" for both languages.
