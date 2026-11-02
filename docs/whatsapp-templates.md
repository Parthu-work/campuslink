# WhatsApp templates (Meta approval)

Every business-initiated WhatsApp message is an approved template. Register each one below in Meta Business Manager under the WhatsApp Business Account, in all three languages, with exactly this text (`{{1}}`, `{{2}}` … are Meta's body variables). The text is copied from `apps/api/src/modules/notifications/channels/whatsapp-templates.ts`; a test fails when they differ.

Variables carry only names, times, session types, company names and counts (and, in an invite, the personal link), never message or request text. Quick-reply buttons carry a signed, expiring token (`WHATSAPP_ACTION_SECRET`), set per message.

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

## `cl_request_waiting`

Sent for: `request_nudge`. Category: **utility**.

- English (en): `{{1}} is still waiting for your reply to their {{2}} request. Reply below so they can plan.`
  - Quick replies: `Accept`, `Decline`
- Telugu (te): `{{1}} తమ {{2}} అభ్యర్థనకు మీ జవాబు కోసం ఇంకా ఎదురుచూస్తున్నారు. వారు ప్లాన్ చేసుకునేలా కింద జవాబివ్వండి.`
  - Quick replies: `అంగీకరించండి`, `తిరస్కరించండి`
- Hindi (hi): `{{1}} अब भी अपने {{2}} अनुरोध पर आपके जवाब का इंतज़ार कर रहे हैं। नीचे जवाब दें ताकि वे योजना बना सकें।`
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

## `cl_drive_open`

Sent for: `drive_open`. Category: **utility**.

- English (en): `{{1}} is hiring through your college and you are eligible. Registration closes {{2}}.`
  - Quick replies: `Register`
- Telugu (te): `{{1}} మీ కాలేజీ ద్వారా నియామకాలు చేస్తోంది, మీరు అర్హులు. నమోదు {{2}}కి ముగుస్తుంది.`
  - Quick replies: `నమోదు చేయండి`
- Hindi (hi): `{{1}} आपके कॉलेज के ज़रिए भर्ती कर रहा है और आप पात्र हैं। पंजीकरण {{2}} को बंद होगा।`
  - Quick replies: `पंजीकरण करें`

## `cl_drive_closing`

Sent for: `drive_reminder`. Category: **utility**. Critical (exempt from the weekly cap).

- English (en): `Last day: registration for the {{1}} drive closes {{2}}. You are eligible and not registered yet.`
  - Quick replies: `Register`
- Telugu (te): `చివరి రోజు: {{1}} డ్రైవ్ నమోదు {{2}}కి ముగుస్తుంది. మీరు అర్హులు, ఇంకా నమోదు చేసుకోలేదు.`
  - Quick replies: `నమోదు చేయండి`
- Hindi (hi): `आखिरी दिन: {{1}} ड्राइव का पंजीकरण {{2}} को बंद होगा। आप पात्र हैं और अभी पंजीकृत नहीं हैं।`
  - Quick replies: `पंजीकरण करें`

## `cl_drive_round`

Sent for: `drive_round_result`. Category: **utility**.

- English (en): `Your {{2}} result for the {{1}} drive is out. Open the app to see it.`
- Telugu (te): `{{1}} డ్రైవ్‌లో మీ {{2}} ఫలితం వచ్చింది. చూడటానికి యాప్ తెరవండి.`
- Hindi (hi): `{{1}} ड्राइव में आपका {{2}} परिणाम आ गया है। देखने के लिए ऐप खोलें।`

## `cl_drive_selected`

Sent for: `drive_selected`. Category: **utility**. Critical (exempt from the weekly cap).

- English (en): `Congratulations: {{1}} selected you. Open the app to see your offer.`
- Telugu (te): `అభినందనలు: {{1}} మిమ్మల్ని ఎంపిక చేసింది. మీ ఆఫర్ చూడటానికి యాప్ తెరవండి.`
- Hindi (hi): `बधाई हो: {{1}} ने आपको चुना है। अपना ऑफ़र देखने के लिए ऐप खोलें।`

## `college_announcement`

Sent for: `announcement`. Category: **utility**. Critical only when the sender marks it urgent.

- English (en): `New from your college: {{1}}. Open the app to read it.`
- Telugu (te): `మీ కాలేజీ నుండి కొత్తది: {{1}}. చదవడానికి యాప్ తెరవండి.`
- Hindi (hi): `आपके कॉलेज से नया: {{1}}। पढ़ने के लिए ऐप खोलें।`

## `cl_job_alert`

Sent for: `job_alert`. Category: **utility**.

- English (en): `{{1}} new openings match your alert “{{2}}”. Open the app to see them.`
- Telugu (te): `మీ అలర్ట్ “{{2}}”కి {{1}} కొత్త ఉద్యోగాలు సరిపోలాయి. చూడటానికి యాప్ తెరవండి.`
- Hindi (hi): `आपके अलर्ट “{{2}}” से {{1}} नई नौकरियां मेल खाती हैं। देखने के लिए ऐप खोलें।`

## `cl_invite_student`

Sent for: an invite to a student on the college's list. Category: **utility**.

- English (en): `Hi {{1}}, {{2}} added you to its private student network. Tap to join; the code comes to this number: {{3}}`
- Telugu (te): `హాయ్ {{1}}, {{2}} మిమ్మల్ని తన ప్రైవేట్ విద్యార్థి నెట్‌వర్క్‌లో చేర్చింది. చేరడానికి నొక్కండి; కోడ్ ఈ నంబర్‌కే వస్తుంది: {{3}}`
- Hindi (hi): `नमस्ते {{1}}, {{2}} ने आपको अपने निजी छात्र नेटवर्क में जोड़ा है। जुड़ने के लिए टैप करें; कोड इसी नंबर पर आएगा: {{3}}`

## `cl_invite_alumni`

Sent for: an invite to a alumni on the college's list. Category: **utility**.

- English (en): `Hi {{1}}, {{2}} invites you to its private alumni network, where you can guide current students. Tap to join: {{3}}`
- Telugu (te): `హాయ్ {{1}}, {{2}} తన ప్రైవేట్ పూర్వ విద్యార్థుల నెట్‌వర్క్‌కి మిమ్మల్ని ఆహ్వానిస్తోంది, అక్కడ మీరు ప్రస్తుత విద్యార్థులకు మార్గదర్శనం చేయవచ్చు. చేరడానికి నొక్కండి: {{3}}`
- Hindi (hi): `नमस्ते {{1}}, {{2}} आपको अपने निजी पूर्व छात्र नेटवर्क में आमंत्रित करता है, जहां आप मौजूदा छात्रों का मार्गदर्शन कर सकते हैं। जुड़ने के लिए टैप करें: {{3}}`

## Fixed auto-reply (free-form, inside the 24-hour window)

- English (en): `This number only sends updates from your college’s app and can’t read replies. Please open the app to answer.`
- Telugu (te): `ఈ నంబర్ మీ కాలేజీ యాప్ నుండి అప్‌డేట్‌లు మాత్రమే పంపుతుంది, జవాబులు చదవలేదు. జవాబివ్వడానికి దయచేసి యాప్ తెరవండి.`
- Hindi (hi): `यह नंबर केवल आपके कॉलेज के ऐप से अपडेट भेजता है और जवाब नहीं पढ़ सकता। जवाब देने के लिए कृपया ऐप खोलें।`
