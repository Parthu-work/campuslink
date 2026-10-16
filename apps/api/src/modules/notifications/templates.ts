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
    post_comment: { title: 'New comment', body: '{name} commented on your post.' },
    comment_reply: { title: 'New reply', body: '{name} replied to your comment.' },
    question_answered: { title: 'New answer', body: '{name} answered your question.' },
    answer_accepted: { title: 'Answer accepted', body: 'Your answer was marked as the best answer.' },
    question_approved: { title: 'Question published', body: 'Your question is now visible to your college.' },
    question_rejected: {
      title: 'Question not published',
      body: 'Moderators didn’t publish your question. Open it to see why.',
    },
    content_removed: {
      title: 'Content removed',
      body: 'Moderators removed your {content}. Open it to see why, and appeal if you disagree.',
    },
    content_restored: { title: 'Content restored', body: 'Your {content} is visible again.' },
    appeal_decided: {
      title: 'Appeal decided',
      body: 'Moderators reviewed your appeal about your {content}.',
    },
    referral_received: { title: 'Referral request', body: '{name} asked you for a referral at {company}.' },
    referral_referred: { title: 'You were referred', body: '{name} referred you at {company}.' },
    referral_declined: { title: 'Referral update', body: '{name} can’t refer you at {company} right now.' },
    referral_expired: {
      title: 'Referral request expired',
      body: 'Your referral request to {name} expired without a reply.',
    },
    job_alert: { title: 'New openings', body: 'New openings match your alert “{alert}”.' },
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
    post_comment: { title: 'కొత్త కామెంట్', body: '{name} మీ పోస్ట్‌పై కామెంట్ చేశారు.' },
    comment_reply: { title: 'కొత్త జవాబు', body: '{name} మీ కామెంట్‌కు జవాబిచ్చారు.' },
    question_answered: { title: 'కొత్త సమాధానం', body: '{name} మీ ప్రశ్నకు సమాధానం ఇచ్చారు.' },
    answer_accepted: {
      title: 'సమాధానం అంగీకరించబడింది',
      body: 'మీ సమాధానాన్ని ఉత్తమ సమాధానంగా గుర్తించారు.',
    },
    question_approved: {
      title: 'ప్రశ్న ప్రచురించబడింది',
      body: 'మీ ప్రశ్న ఇప్పుడు మీ కాలేజీకి కనిపిస్తుంది.',
    },
    question_rejected: {
      title: 'ప్రశ్న ప్రచురించలేదు',
      body: 'మోడరేటర్లు మీ ప్రశ్నను ప్రచురించలేదు. కారణం చూడటానికి తెరవండి.',
    },
    content_removed: {
      title: 'కంటెంట్ తొలగించబడింది',
      body: 'మోడరేటర్లు మీ {content} ని తొలగించారు. కారణం చూడటానికి తెరవండి, అంగీకరించకపోతే అప్పీల్ చేయండి.',
    },
    content_restored: { title: 'కంటెంట్ పునరుద్ధరించబడింది', body: 'మీ {content} మళ్లీ కనిపిస్తోంది.' },
    appeal_decided: {
      title: 'అప్పీల్‌పై నిర్ణయం',
      body: 'మీ {content} గురించి మీ అప్పీల్‌ను మోడరేటర్లు పరిశీలించారు.',
    },
    referral_received: { title: 'రిఫరల్ అభ్యర్థన', body: '{company} లో రిఫరల్ కోసం {name} అడిగారు.' },
    referral_referred: {
      title: 'మిమ్మల్ని రిఫర్ చేశారు',
      body: '{name} మిమ్మల్ని {company} లో రిఫర్ చేశారు.',
    },
    referral_declined: { title: 'రిఫరల్ అప్‌డేట్', body: '{name} ప్రస్తుతం {company} లో రిఫర్ చేయలేరు.' },
    referral_expired: {
      title: 'రిఫరల్ అభ్యర్థన గడువు ముగిసింది',
      body: '{name} కి మీ రిఫరల్ అభ్యర్థనకు జవాబు రాకుండానే గడువు ముగిసింది.',
    },
    job_alert: { title: 'కొత్త ఉద్యోగాలు', body: 'మీ అలర్ట్ “{alert}” కు సరిపోయే కొత్త ఉద్యోగాలు ఉన్నాయి.' },
  },
};

const CONTENT_LABEL: Record<Locale, Record<string, string>> = {
  en: {
    post: 'post',
    comment: 'comment',
    question: 'question',
    answer: 'answer',
    story: 'story',
    item: 'item',
    job: 'job post',
  },
  te: {
    post: 'పోస్ట్',
    comment: 'కామెంట్',
    question: 'ప్రశ్న',
    answer: 'సమాధానం',
    story: 'స్టోరీ',
    item: 'అంశం',
    job: 'ఉద్యోగ పోస్ట్',
  },
};

/** Where content lives in the app (moderation notices link back to it). */
function contentPath(data: Record<string, string>): string {
  switch (data.contentType) {
    case 'post':
      return `/posts/${data.contentId ?? ''}`;
    case 'comment':
      return data.postId ? `/posts/${data.postId}` : '/home';
    case 'question':
      return `/questions/${data.contentId ?? ''}`;
    case 'answer':
      return data.questionId ? `/questions/${data.questionId}` : '/questions';
    case 'job':
      return `/jobs/${data.contentId ?? ''}`;
    default:
      return '/home';
  }
}

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
    case 'post_comment':
    case 'comment_reply':
      return data.postId ? `/posts/${data.postId}` : '/home';
    case 'question_answered':
    case 'answer_accepted':
    case 'question_approved':
    case 'question_rejected':
      return data.questionId ? `/questions/${data.questionId}` : '/questions';
    case 'content_removed':
    case 'content_restored':
    case 'appeal_decided':
      return contentPath(data);
    case 'referral_received':
      return '/referrals';
    case 'referral_referred':
    case 'referral_declined':
    case 'referral_expired':
      return '/referrals?box=sent';
    case 'job_alert':
      return data.alertId ? `/jobs?alert=${data.alertId}` : '/jobs';
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
      .replace('{time}', time)
      .replace('{content}', CONTENT_LABEL[locale][data.contentType ?? ''] ?? '')
      .replace('{company}', data.company ?? '')
      .replace('{alert}', data.alert ?? '');
  return { title: fill(t.title), body: fill(t.body), footer: FOOTER[locale], open: OPEN[locale] };
}
