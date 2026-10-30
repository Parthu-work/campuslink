import type { NotificationType, SessionType } from '@campuslink/shared';

/** Languages a WhatsApp template is registered in (Meta language codes). */
export const WA_LANGS = ['en', 'te', 'hi'] as const;
export type WaLang = (typeof WA_LANGS)[number];

/** What a quick-reply button does when tapped (the webhook runs it through the owning service). */
export type ChannelAction = 'request_accept' | 'request_decline' | 'booking_ack' | 'drive_register';

export interface WaTemplate {
  /** The name the template is approved under in Meta Business Manager. */
  name: string;
  category: 'utility' | 'authentication';
  /** Exempt from the member's weekly cap (codes, session reminders, drive deadlines). */
  critical: boolean;
  /** Critical only when the notification data says `urgent: '1'` (urgent announcements, B6). */
  urgentable?: boolean;
  /**
   * Body parameters in {{1}}, {{2}} … order: names, times, session types, company names and counts
   * only, never message or request text (CLAUDE.md).
   */
  params: (data: Record<string, string>, c: { lang: WaLang; timezone: string }) => string[];
  /** Quick-reply buttons: the action and the id it acts on (from the notification data). */
  buttons?: { action: ChannelAction; ref: string; label: Record<WaLang, string> }[];
  /** The exact approved text, per language (copied into docs/whatsapp-templates.md). */
  text: Record<WaLang, string>;
}

const SESSION_LABEL: Record<WaLang, Record<SessionType, string>> = {
  en: {
    quick_chat: 'quick chat',
    video_1on1: '1:1 video call',
    mock_interview: 'mock interview',
    resume_review: 'resume review',
  },
  te: {
    quick_chat: 'క్విక్ చాట్',
    video_1on1: '1:1 వీడియో కాల్',
    mock_interview: 'మాక్ ఇంటర్వ్యూ',
    resume_review: 'రెజ్యూమ్ రివ్యూ',
  },
  hi: {
    quick_chat: 'क्विक चैट',
    video_1on1: '1:1 वीडियो कॉल',
    mock_interview: 'मॉक इंटरव्यू',
    resume_review: 'रिज़्यूमे रिव्यू',
  },
};
const LOCALE: Record<WaLang, string> = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN' };

const session = (d: Record<string, string>, lang: WaLang) =>
  SESSION_LABEL[lang][d.sessionType as SessionType] ?? d.sessionType ?? '';
const when = (iso: string | undefined, lang: WaLang, timezone: string) =>
  iso
    ? new Intl.DateTimeFormat(LOCALE[lang], {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(iso))
    : '';

/** Notification types that have a WhatsApp template. Anything else never goes to WhatsApp. */
export const WHATSAPP_TEMPLATES: Partial<Record<NotificationType, WaTemplate>> = {
  request_received: {
    name: 'cl_request_received',
    category: 'utility',
    critical: false,
    params: (d, c) => [d.name ?? '', session(d, c.lang)],
    buttons: [
      {
        action: 'request_accept',
        ref: 'requestId',
        label: { en: 'Accept', te: 'అంగీకరించండి', hi: 'स्वीकार करें' },
      },
      {
        action: 'request_decline',
        ref: 'requestId',
        label: { en: 'Decline', te: 'తిరస్కరించండి', hi: 'मना करें' },
      },
    ],
    text: {
      en: '{{1}} asked you for a {{2}} on your college’s mentoring app. Reply below, or open the app to read the request.',
      te: '{{1}} మీ కాలేజీ మెంటారింగ్ యాప్‌లో మిమ్మల్ని {{2}} కోసం అడిగారు. కింద జవాబివ్వండి, లేదా అభ్యర్థన చదవడానికి యాప్ తెరవండి.',
      hi: '{{1}} ने आपके कॉलेज के मेंटरिंग ऐप पर आपसे {{2}} के लिए अनुरोध किया है। नीचे जवाब दें, या अनुरोध पढ़ने के लिए ऐप खोलें।',
    },
  },
  request_nudge: {
    name: 'cl_request_waiting',
    category: 'utility',
    critical: false,
    params: (d, c) => [d.name ?? '', session(d, c.lang)],
    buttons: [
      {
        action: 'request_accept',
        ref: 'requestId',
        label: { en: 'Accept', te: 'అంగీకరించండి', hi: 'स्वीकार करें' },
      },
      {
        action: 'request_decline',
        ref: 'requestId',
        label: { en: 'Decline', te: 'తిరస్కరించండి', hi: 'मना करें' },
      },
    ],
    text: {
      en: '{{1}} is still waiting for your reply to their {{2}} request. Reply below so they can plan.',
      te: '{{1}} తమ {{2}} అభ్యర్థనకు మీ జవాబు కోసం ఇంకా ఎదురుచూస్తున్నారు. వారు ప్లాన్ చేసుకునేలా కింద జవాబివ్వండి.',
      hi: '{{1}} अब भी अपने {{2}} अनुरोध पर आपके जवाब का इंतज़ार कर रहे हैं। नीचे जवाब दें ताकि वे योजना बना सकें।',
    },
  },
  request_accepted: {
    name: 'cl_request_accepted',
    category: 'utility',
    critical: false,
    params: (d, c) => [d.name ?? '', session(d, c.lang)],
    text: {
      en: '{{1}} accepted your {{2}} request. Open the app to see the time and chat.',
      te: '{{1}} మీ {{2}} అభ్యర్థనను అంగీకరించారు. సమయం, చాట్ చూడటానికి యాప్ తెరవండి.',
      hi: '{{1}} ने आपका {{2}} अनुरोध स्वीकार कर लिया है। समय और चैट देखने के लिए ऐप खोलें।',
    },
  },
  booking_reminder: {
    name: 'cl_session_reminder',
    category: 'utility',
    critical: true,
    params: (d, c) => [session(d, c.lang), d.name ?? '', when(d.start, c.lang, c.timezone)],
    buttons: [
      {
        action: 'booking_ack',
        ref: 'bookingId',
        label: { en: 'I’ll be there', te: 'నేను వస్తాను', hi: 'मैं आऊंगा/आऊंगी' },
      },
    ],
    text: {
      en: 'Reminder: your {{1}} with {{2}} starts at {{3}}. Open the app to join.',
      te: 'గుర్తు: {{2}}తో మీ {{1}} {{3}}కి మొదలవుతుంది. చేరడానికి యాప్ తెరవండి.',
      hi: 'याद दिलाना: {{2}} के साथ आपका {{1}} {{3}} बजे शुरू होगा। जुड़ने के लिए ऐप खोलें।',
    },
  },
  booking_rescheduled: {
    name: 'cl_session_moved',
    category: 'utility',
    critical: false,
    params: (d, c) => [d.name ?? '', session(d, c.lang), when(d.start, c.lang, c.timezone)],
    text: {
      en: '{{1}} moved your {{2}} to {{3}}.',
      te: '{{1}} మీ {{2}}ని {{3}}కి మార్చారు.',
      hi: '{{1}} ने आपका {{2}} {{3}} पर कर दिया है।',
    },
  },
  booking_cancelled: {
    name: 'cl_session_cancelled',
    category: 'utility',
    critical: false,
    params: (d, c) => [session(d, c.lang), d.name ?? '', when(d.start, c.lang, c.timezone)],
    text: {
      en: 'Your {{1}} with {{2}} on {{3}} was cancelled. You can book another time in the app.',
      te: '{{3}}న {{2}}తో మీ {{1}} రద్దయింది. యాప్‌లో మరో సమయం బుక్ చేసుకోవచ్చు.',
      hi: '{{3}} को {{2}} के साथ आपका {{1}} रद्द हो गया है। आप ऐप में दूसरा समय बुक कर सकते हैं।',
    },
  },
  drive_open: {
    name: 'cl_drive_open',
    category: 'utility',
    critical: false,
    params: (d, c) => [d.company ?? '', when(d.start, c.lang, c.timezone)],
    buttons: [
      {
        action: 'drive_register',
        ref: 'driveId',
        label: { en: 'Register', te: 'నమోదు చేయండి', hi: 'पंजीकरण करें' },
      },
    ],
    text: {
      en: '{{1}} is hiring through your college and you are eligible. Registration closes {{2}}.',
      te: '{{1}} మీ కాలేజీ ద్వారా నియామకాలు చేస్తోంది, మీరు అర్హులు. నమోదు {{2}}కి ముగుస్తుంది.',
      hi: '{{1}} आपके कॉलेज के ज़रिए भर्ती कर रहा है और आप पात्र हैं। पंजीकरण {{2}} को बंद होगा।',
    },
  },
  drive_reminder: {
    name: 'cl_drive_closing',
    category: 'utility',
    critical: true,
    params: (d, c) => [d.company ?? '', when(d.start, c.lang, c.timezone)],
    buttons: [
      {
        action: 'drive_register',
        ref: 'driveId',
        label: { en: 'Register', te: 'నమోదు చేయండి', hi: 'पंजीकरण करें' },
      },
    ],
    text: {
      en: 'Last day: registration for the {{1}} drive closes {{2}}. You are eligible and not registered yet.',
      te: 'చివరి రోజు: {{1}} డ్రైవ్ నమోదు {{2}}కి ముగుస్తుంది. మీరు అర్హులు, ఇంకా నమోదు చేసుకోలేదు.',
      hi: 'आखिरी दिन: {{1}} ड्राइव का पंजीकरण {{2}} को बंद होगा। आप पात्र हैं और अभी पंजीकृत नहीं हैं।',
    },
  },
  drive_round_result: {
    name: 'cl_drive_round',
    category: 'utility',
    critical: false,
    params: (d) => [d.company ?? '', d.round ?? ''],
    text: {
      en: 'Your {{2}} result for the {{1}} drive is out. Open the app to see it.',
      te: '{{1}} డ్రైవ్‌లో మీ {{2}} ఫలితం వచ్చింది. చూడటానికి యాప్ తెరవండి.',
      hi: '{{1}} ड्राइव में आपका {{2}} परिणाम आ गया है। देखने के लिए ऐप खोलें।',
    },
  },
  drive_selected: {
    name: 'cl_drive_selected',
    category: 'utility',
    critical: true,
    params: (d) => [d.company ?? ''],
    text: {
      en: 'Congratulations: {{1}} selected you. Open the app to see your offer.',
      te: 'అభినందనలు: {{1}} మిమ్మల్ని ఎంపిక చేసింది. మీ ఆఫర్ చూడటానికి యాప్ తెరవండి.',
      hi: 'बधाई हो: {{1}} ने आपको चुना है। अपना ऑफ़र देखने के लिए ऐप खोलें।',
    },
  },
  announcement: {
    name: 'college_announcement',
    category: 'utility',
    critical: false,
    urgentable: true,
    // The announcement's title only (first line, at most 60 characters), never its body.
    params: (d) => [d.title ?? ''],
    text: {
      en: 'New from your college: {{1}}. Open the app to read it.',
      te: 'మీ కాలేజీ నుండి కొత్తది: {{1}}. చదవడానికి యాప్ తెరవండి.',
      hi: 'आपके कॉलेज से नया: {{1}}। पढ़ने के लिए ऐप खोलें।',
    },
  },
  job_alert: {
    name: 'cl_job_alert',
    category: 'utility',
    critical: false,
    params: (d) => [d.count ?? '', d.alert ?? ''],
    text: {
      en: '{{1}} new openings match your alert “{{2}}”. Open the app to see them.',
      te: 'మీ అలర్ట్ “{{2}}”కి {{1}} కొత్త ఉద్యోగాలు సరిపోలాయి. చూడటానికి యాప్ తెరవండి.',
      hi: 'आपके अलर्ट “{{2}}” से {{1}} नई नौकरियां मेल खाती हैं। देखने के लिए ऐप खोलें।',
    },
  },
};

/**
 * Invites to people on the college's list who are not members yet (B4). The college confirms they
 * agreed to hear from it on WhatsApp before sending. Variables: first name, college, the link.
 */
export const INVITE_TEMPLATES: Record<'student' | 'alumni', WaTemplate> = {
  student: {
    name: 'cl_invite_student',
    category: 'utility',
    critical: false,
    params: (d) => [d.name ?? '', d.college ?? '', d.link ?? ''],
    text: {
      en: 'Hi {{1}}, {{2}} added you to its private student network. Tap to join; the code comes to this number: {{3}}',
      te: 'హాయ్ {{1}}, {{2}} మిమ్మల్ని తన ప్రైవేట్ విద్యార్థి నెట్‌వర్క్‌లో చేర్చింది. చేరడానికి నొక్కండి; కోడ్ ఈ నంబర్‌కే వస్తుంది: {{3}}',
      hi: 'नमस्ते {{1}}, {{2}} ने आपको अपने निजी छात्र नेटवर्क में जोड़ा है। जुड़ने के लिए टैप करें; कोड इसी नंबर पर आएगा: {{3}}',
    },
  },
  alumni: {
    name: 'cl_invite_alumni',
    category: 'utility',
    critical: false,
    params: (d) => [d.name ?? '', d.college ?? '', d.link ?? ''],
    text: {
      en: 'Hi {{1}}, {{2}} invites you to its private alumni network, where you can guide current students. Tap to join: {{3}}',
      te: 'హాయ్ {{1}}, {{2}} తన ప్రైవేట్ పూర్వ విద్యార్థుల నెట్‌వర్క్‌కి మిమ్మల్ని ఆహ్వానిస్తోంది, అక్కడ మీరు ప్రస్తుత విద్యార్థులకు మార్గదర్శనం చేయవచ్చు. చేరడానికి నొక్కండి: {{3}}',
      hi: 'नमस्ते {{1}}, {{2}} आपको अपने निजी पूर्व छात्र नेटवर्क में आमंत्रित करता है, जहां आप मौजूदा छात्रों का मार्गदर्शन कर सकते हैं। जुड़ने के लिए टैप करें: {{3}}',
    },
  },
};

/** The fixed answer to any free-text message (never stored). */
export const AUTO_REPLY: Record<WaLang, string> = {
  en: 'This number only sends updates from your college’s app and can’t read replies. Please open the app to answer.',
  te: 'ఈ నంబర్ మీ కాలేజీ యాప్ నుండి అప్‌డేట్‌లు మాత్రమే పంపుతుంది, జవాబులు చదవలేదు. జవాబివ్వడానికి దయచేసి యాప్ తెరవండి.',
  hi: 'यह नंबर केवल आपके कॉलेज के ऐप से अपडेट भेजता है और जवाब नहीं पढ़ सकता। जवाब देने के लिए कृपया ऐप खोलें।',
};

/** The authentication template is Meta's fixed text; only its name and settings are ours. */
export const AUTH_TEMPLATE_SETTINGS = {
  code_expiration_minutes: 10,
  add_security_recommendation: true,
} as const;
