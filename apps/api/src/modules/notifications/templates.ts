import type { Locale } from '@campuslink/shared';
import type { NotificationType, SessionType } from '@campuslink/shared';

/**
 * Server-side text for email and push (the web app renders in-app notifications with i18next).
 * Only names, session types and times are interpolated — never message or request text.
 */
const TYPE_LABEL: Record<Locale, Record<SessionType, string>> = {
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
};

type Text = { title: string; body: string };
const T: Record<Locale, Record<NotificationType, Text>> = {
  en: {
    request_received: { title: 'New mentorship request', body: '{name} asked you for a {type}.' },
    request_accepted: { title: 'Request accepted', body: '{name} accepted your {type} request.' },
    request_declined: { title: 'Request update', body: '{name} can’t take your request right now.' },
    request_expired: {
      title: 'Request expired',
      body: 'Your request to {name} expired without a reply. You can ask another mentor.',
    },
    booking_rescheduled: { title: 'Session moved', body: '{name} moved your {type} to {time}.' },
    booking_cancelled: {
      title: 'Session cancelled',
      body: 'Your {type} with {name} on {time} was cancelled.',
    },
    booking_reminder: { title: 'Session reminder', body: 'Your {type} with {name} starts {time}.' },
    session_completed: { title: 'How did it go?', body: 'Rate your {type} with {name}.' },
    feedback_received: { title: 'New feedback', body: 'A mentee rated your session.' },
    new_message: { title: 'New message', body: '{name} sent you a message.' },
  },
  te: {
    request_received: { title: 'కొత్త మెంటర్‌షిప్ అభ్యర్థన', body: '{name} మిమ్మల్ని {type} కోసం అడిగారు.' },
    request_accepted: {
      title: 'అభ్యర్థన అంగీకరించబడింది',
      body: '{name} మీ {type} అభ్యర్థనను అంగీకరించారు.',
    },
    request_declined: {
      title: 'అభ్యర్థనపై అప్‌డేట్',
      body: '{name} ప్రస్తుతం మీ అభ్యర్థనను తీసుకోలేకపోతున్నారు.',
    },
    request_expired: {
      title: 'అభ్యర్థన గడువు ముగిసింది',
      body: '{name} కి మీరు పంపిన అభ్యర్థనకు జవాబు రాలేదు. మీరు వేరే మెంటర్‌ను అడగవచ్చు.',
    },
    booking_rescheduled: { title: 'సెషన్ సమయం మారింది', body: '{name} మీ {type} ని {time} కి మార్చారు.' },
    booking_cancelled: { title: 'సెషన్ రద్దయింది', body: '{time} న {name} తో మీ {type} రద్దయింది.' },
    booking_reminder: { title: 'సెషన్ రిమైండర్', body: '{name} తో మీ {type} {time} కి మొదలవుతుంది.' },
    session_completed: { title: 'ఎలా జరిగింది?', body: '{name} తో మీ {type} కి రేటింగ్ ఇవ్వండి.' },
    feedback_received: { title: 'కొత్త ఫీడ్‌బ్యాక్', body: 'ఒక మెంటీ మీ సెషన్‌కు రేటింగ్ ఇచ్చారు.' },
    new_message: { title: 'కొత్త సందేశం', body: '{name} మీకు సందేశం పంపారు.' },
  },
};

const FOOTER: Record<Locale, string> = {
  en: 'You can change which notifications you get in Settings → Notifications.',
  te: 'మీకు ఏ నోటిఫికేషన్లు రావాలో సెట్టింగ్స్ → నోటిఫికేషన్స్‌లో మార్చుకోవచ్చు.',
};
const OPEN: Record<Locale, string> = { en: 'Open', te: 'తెరవండి' };

/** In-app path a notification links to. */
export function pathFor(type: NotificationType, data: Record<string, string>): string {
  switch (type) {
    case 'request_received':
      return '/mentorship?box=received';
    case 'request_declined':
    case 'request_expired':
      return '/mentorship?box=sent';
    case 'request_accepted':
      return data.bookingId
        ? '/sessions'
        : data.conversationId
          ? `/messages/${data.conversationId}`
          : '/mentorship?box=sent';
    case 'new_message':
      return data.conversationId ? `/messages/${data.conversationId}` : '/messages';
    case 'feedback_received':
      return '/mentor';
    default:
      return '/sessions';
  }
}

export function renderNotification(
  type: NotificationType,
  data: Record<string, string>,
  locale: Locale,
  timezone: string,
): Text & { footer: string; open: string } {
  const t = T[locale][type];
  const time = data.start
    ? new Intl.DateTimeFormat(locale === 'te' ? 'te-IN' : 'en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(data.start))
    : '';
  const fill = (s: string) =>
    s
      .replace('{name}', data.name ?? '')
      .replace('{type}', TYPE_LABEL[locale][data.sessionType as SessionType] ?? '')
      .replace('{time}', time);
  return { title: fill(t.title), body: fill(t.body), footer: FOOTER[locale], open: OPEN[locale] };
}
