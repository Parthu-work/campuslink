# Adding a language

A new language (Tamil, Kannada, Marathi …) is a translation job, not a code change. Hindi (`hi`) was added this way in build phase B12; follow the same steps.

## 1. Register the locale

Edit `packages/shared/src/locales.ts`:

- add the code to `SUPPORTED_LOCALES` (for example `'ta'`);
- add its own-script name to `LOCALE_NAMES` (`'தமிழ்'`), its `Intl` tag to `LOCALE_TAGS` (`'ta-IN'`) and its English name to `LOCALE_ENGLISH_NAMES` (`'Tamil'`).

Everything else derives from this list: the Zod schemas (`schemas/auth.ts`, `schemas/users.ts`, `schemas/onboarding.ts`), the Mongoose enums (`user.model.ts`, `study/chat.model.ts`), the language pickers (Settings › Preferences, the landing page, the guardian declaration) and the command palette's "switch language" cycle. No database migration is needed: adding a value to an enum accepts new documents and leaves old ones valid.

Run `pnpm typecheck`. Every per-language table that is missing the new language is now a type error (`Record<Locale, …>`); those errors are the to-do list for steps 2 and 3.

## 2. Web strings

1. Copy `apps/web/src/i18n/en.json` to `apps/web/src/i18n/<code>.json` and translate every value. Keep:
   - every `{{placeholder}}` exactly as it is (the parity test fails otherwise);
   - plural pairs (`_one`, `_other`); add the language's other plural forms (`_few`, `_many`) only if the runtime is extended for them;
   - product names (`{{app}}`), brand names (WhatsApp, Google Sheet, GATE) and code examples (`**bold**`, `/videos`, `21CSE117`) untranslated.
2. Add the file to `bundles` in `apps/web/src/i18n/index.ts` (`ta: () => import('./ta.json')`). Bundles load lazily: only the member's language is downloaded, so the first load does not grow.
3. Run `pnpm --filter @campuslink/web exec vitest run src/i18n`. `parity.test.ts` checks that every supported locale has a file, the same keys as English, the same placeholders and no empty strings.

## 3. Server texts

These have one entry per language and fail to typecheck until the new one is added:

| File                                                                | What                                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/modules/notifications/templates.ts`                   | Email and push text for every notification type, session type labels, content labels, footer                                               |
| `apps/web/src/features/guardian/declaration.ts`                     | The guardian's consent declaration (a legal text: new wording needs legal review, see `docs/privacy.md`)                                   |
| `apps/api/src/modules/notifications/channels/whatsapp-templates.ts` | WhatsApp templates (`WA_LANGS`), copied into `docs/whatsapp-templates.md` and submitted to Meta for approval in that language              |
| `apps/api/src/modules/notifications/channels/sms-templates.ts`      | An `otp_<code>` template (optional), copied into `docs/sms-templates.md` and registered on DLT; English is used until its id is configured |

`test/channel-templates.test.ts` checks that every notification has a title and body in every language with the same placeholders as English, and that the WhatsApp and SMS docs match the code character for character.

Invoices stay in English: GST invoices are commonly issued in English, and the PDF library (`pdf-lib`) cannot shape Indic scripts (vowel signs and conjuncts would render broken).

## 4. Script, font and the study assistant

- **Font.** Add a self-hosted variable font for the script next to Anek Telugu and Anek Devanagari: install the `@fontsource-variable/<family>` package, import it in `apps/web/src/main.tsx` and append the family to `--font-display`, `--font-body` and `--font-mono` in `apps/web/src/styles/tokens.css`. Fontsource CSS uses `unicode-range`, so the font downloads only when that script is on screen; preload nothing.
- **Line height.** Scripts with stacked vowel signs need looser lines: add the language to the `:root:is([lang='te'], [lang='hi'])` rules in `apps/web/src/styles/index.css`.
- **Study assistant.** `detectLanguage()` in `apps/api/src/modules/study/chat/prompt.ts` answers in the script of the question. Add the script's Unicode block (Tamil is U+0B80–U+0BFF) so it returns the new code; the system prompt then says "Reply in Tamil" from `LOCALE_ENGLISH_NAMES`. Add the code to `MATERIAL_LANGUAGES` (`packages/shared/src/constants/study.ts`) and a `study.language.<code>` string in every locale so teachers can tag material in it.

## 5. Review and ship

1. List the strings a native speaker must check in `docs/build/translation-review.md` (legal and consent texts first).
2. Add an end-to-end check that switches to the language (see `apps/web/e2e/core.spec.ts`, "switches to Hindi").
3. Check a few screens at 360 px in both themes: longer words wrap, and the script renders in the right font.
4. Run the full gate (`CLAUDE.md`) and the bundle budget: the initial JS must not change.
