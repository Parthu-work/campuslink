# SMS templates (India DLT registration)

Every SMS the platform sends is a template registered on the DLT platform under the principal entity (`SMS_DLT_ENTITY_ID`) and the sender header (`SMS_SENDER_ID`). Carriers drop any message whose text differs from the registered template by a single character, so each template below is copied **character for character** from `apps/api/src/modules/notifications/channels/sms-templates.ts` (a test fails when they differ). `{#var#}` is DLT's variable placeholder.

After registration, put the template ids in `SMS_DLT_TEMPLATE_IDS` as `key=id` pairs, for example `otp=1107161234567890123`.

| Key   | Category         | Text                                                                                     |
| ----- | ---------------- | ---------------------------------------------------------------------------------------- |
| `otp` | service_implicit | `{#var#} is your CampusLink code. It expires in 10 minutes. Never share it with anyone.` |

The product name in the text comes from `packages/shared/src/brand.ts`; if it changes, every template must be registered again.
