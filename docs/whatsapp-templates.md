# WhatsApp templates (Meta approval)

Every business-initiated WhatsApp message is an approved template. Register each one below in Meta Business Manager under the WhatsApp Business Account, in all three languages, with exactly this text (`{{1}}`, `{{2}}` … are Meta's body variables). The text is copied from `apps/api/src/modules/notifications/channels/whatsapp-templates.ts`; a test fails when they differ.

Variables carry only names, times, session types, company names and counts, never message or request text. Quick-reply buttons carry a signed, expiring token (`WHATSAPP_ACTION_SECRET`), set per message.

## Authentication template

Name: the value of `WHATSAPP_AUTH_TEMPLATE` (default `auth_code`). Category: **authentication**, with a copy-code button. The body is Meta's fixed text; set `code_expiration_minutes: 10` and `add_security_recommendation: true`. Register it in English, Telugu and Hindi.

## `cl_request_received`

Sent for: `request_received`. Category: **utility**.

- English (en): `{{1}} asked you for a {{2}} on your college’s mentoring app. Reply below, or open the app to read the request.`
  - Quick replies: `Accept`, `Decline`
- Telugu (te): `{{1}} మీ కాలేజీ మెంటారింగ్ యాప్‌లో మిమ్మల్ని {{2}} కోసం అడిగారు. కింద జవాబివ్వండి, లేదా అభ్యర్థన చదవడానికి యాప్ తెరవండి.`
  - Quick replies: `అంగీకరించండి`, `తిరస్కరించండి`
- Hindi (hi): `{{1}} ने आपके कॉलेज के मेंटरिंग ऐप पर आपसे {{2}} के लिए अनुरोध किया है। नीचे जवाब दें, या अनुरोध पढ़ने के लिए ऐप खोलें।`
  - Quick replies: `स्वीकार करें`, `मना करें`

## `cl_request_accepted`

Sent for: `request_accepted`. Category: **utility**.

- English (en): `{{1}} accepted your {{2}} request. Open the app to see the time and chat.`
- Telugu (te): `{{1}} మీ {{2}} అభ్యర్థనను అంగీకరించారు. సమయం, చాట్ చూడటానికి యాప్ తెరవండి.`
- Hindi (hi): `{{1}} ने आपका {{2}} अनुरोध स्वीकार कर लिया है। समय और चैट देखने के लिए ऐप खोलें।`

## `cl_session_reminder`

Sent for: `booking_reminder`. Category: **utility**. Critical (exempt from the weekly cap).

- English (en): `Reminder: your {{1}} with {{2}} starts at {{3}}. Open the app to join.`
  - Quick replies: `I’ll be there`
- Telugu (te): `గుర్తు: {{2}}తో మీ {{1}} {{3}}కి మొదలవుతుంది. చేరడానికి యాప్ తెరవండి.`
  - Quick replies: `నేను వస్తాను`
- Hindi (hi): `याद दिलाना: {{2}} के साथ आपका {{1}} {{3}} बजे शुरू होगा। जुड़ने के लिए ऐप खोलें।`
  - Quick replies: `मैं आऊंगा/आऊंगी`

## `cl_session_moved`

Sent for: `booking_rescheduled`. Category: **utility**.

- English (en): `{{1}} moved your {{2}} to {{3}}.`
- Telugu (te): `{{1}} మీ {{2}}ని {{3}}కి మార్చారు.`
- Hindi (hi): `{{1}} ने आपका {{2}} {{3}} पर कर दिया है।`

## `cl_session_cancelled`

Sent for: `booking_cancelled`. Category: **utility**.

- English (en): `Your {{1}} with {{2}} on {{3}} was cancelled. You can book another time in the app.`
- Telugu (te): `{{3}}న {{2}}తో మీ {{1}} రద్దయింది. యాప్‌లో మరో సమయం బుక్ చేసుకోవచ్చు.`
- Hindi (hi): `{{3}} को {{2}} के साथ आपका {{1}} रद्द हो गया है। आप ऐप में दूसरा समय बुक कर सकते हैं।`

## `cl_job_alert`

Sent for: `job_alert`. Category: **utility**.

- English (en): `{{1}} new openings match your alert “{{2}}”. Open the app to see them.`
- Telugu (te): `మీ అలర్ట్ “{{2}}”కి {{1}} కొత్త ఉద్యోగాలు సరిపోలాయి. చూడటానికి యాప్ తెరవండి.`
- Hindi (hi): `आपके अलर्ट “{{2}}” से {{1}} नई नौकरियां मेल खाती हैं। देखने के लिए ऐप खोलें।`

## Fixed auto-reply (free-form, inside the 24-hour window)

- English (en): `This number only sends updates from your college’s app and can’t read replies. Please open the app to answer.`
- Telugu (te): `ఈ నంబర్ మీ కాలేజీ యాప్ నుండి అప్‌డేట్‌లు మాత్రమే పంపుతుంది, జవాబులు చదవలేదు. జవాబివ్వడానికి దయచేసి యాప్ తెరవండి.`
- Hindi (hi): `यह नंबर केवल आपके कॉलेज के ऐप से अपडेट भेजता है और जवाब नहीं पढ़ सकता। जवाब देने के लिए कृपया ऐप खोलें।`
