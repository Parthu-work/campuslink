# SMS templates (India DLT registration)

Every SMS the platform sends is a template registered on the DLT platform under the principal entity (`SMS_DLT_ENTITY_ID`) and the sender header (`SMS_SENDER_ID`). Carriers drop any message whose text differs from the registered template by a single character, so each template below is copied **character for character** from `apps/api/src/modules/notifications/channels/sms-templates.ts` (a test fails when they differ). `{#var#}` is DLT's variable placeholder.

After registration, put the template ids in `SMS_DLT_TEMPLATE_IDS` as `key=id` pairs, for example `otp=1107161234567890123,session_reminder=1107161234567890124`.

| Key                   | Category         | Text                                                                                                  |
| --------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `otp`                 | service_implicit | `{#var#} is your CampusLink code. It expires in 10 minutes. Never share it with anyone.`              |
| `otp_hi`              | service_implicit | `{#var#} आपका CampusLink कोड है। यह 10 मिनट में समाप्त हो जाएगा। इसे किसी के साथ साझा न करें।`        |
| `session_reminder`    | service_explicit | `{#var#}, your CampusLink session starts at {#var#}. Open {#var#} to join.`                           |
| `session_reminder_te` | service_explicit | `{#var#}, మీ CampusLink సెషన్ {#var#}కి మొదలవుతుంది. చేరడానికి {#var#} తెరవండి.`                      |
| `session_reminder_hi` | service_explicit | `{#var#}, आपका CampusLink सत्र {#var#} बजे शुरू होगा। जुड़ने के लिए {#var#} खोलें।`                   |
| `drive_reminder`      | service_explicit | `{#var#}, registration for a placement drive on CampusLink closes at {#var#}. Register at {#var#}`    |
| `drive_reminder_te`   | service_explicit | `{#var#}, CampusLinkలో ఒక ప్లేస్‌మెంట్ డ్రైవ్ నమోదు {#var#}కి ముగుస్తుంది. {#var#}లో నమోదు చేయండి.`   |
| `drive_reminder_hi`   | service_explicit | `{#var#}, CampusLink पर एक प्लेसमेंट ड्राइव का पंजीकरण {#var#} को बंद होगा। {#var#} पर पंजीकरण करें।` |

`otp_hi` is the Hindi code message (B12). Register it as a Unicode template; until its id is in `SMS_DLT_TEMPLATE_IDS`, members who use Hindi get the English `otp`.

## Critical reminders (prompt 1b, R4)

`session_reminder` (a session starting within the hour) and `drive_reminder` (a drive whose registration closes soon) are the only messages besides codes that ever go by SMS. They go only when all of these hold: the member has a verified number; WhatsApp is off for them, they have not opted in, or its send failed; the template's id is in `SMS_DLT_TEMPLATE_IDS`; the member has not turned off **SMS reminders** in Settings › Notifications (on by default); quiet hours allow it (session reminders ignore quiet hours on every channel, because the member chose the time); and the college has not used up its monthly message allowance.

The variables are, in order: the member's first name, the time (in their language and time zone), and a link to the app. Register the third as a URL variable (`{#url#}` on DLT platforms that type variables) and whitelist the college domains it can carry; most DLT platforms limit a plain `{#var#}` to 30 characters.

The `_te` and `_hi` versions are Unicode templates of their own. Until a language's id is set, members who use it get the English reminder. Their wording is in the native-speaker review list (`docs/build/translation-review.md`).

The product name in the text comes from `packages/shared/src/brand.ts`; if it changes, every template must be registered again.
