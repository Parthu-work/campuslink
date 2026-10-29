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
    roadmap_nudge: {
      title: 'Your weekly roadmap goal',
      body: 'A small step on “{roadmap}” this week keeps you on track.',
    },
    roadmap_approved: { title: 'Roadmap published', body: '{name} approved your changes to “{roadmap}”.' },
    roadmap_changes_requested: {
      title: 'Roadmap review',
      body: '{name} asked for changes to “{roadmap}”.',
    },
    badge_earned: { title: 'New badge', body: 'You earned a new badge. Open your progress to see it.' },
    redemption_decided: { title: 'Reward update', body: 'Your request for “{reward}” was {decision}.' },
    event_reminder: { title: 'Event reminder', body: '“{event}” starts {time}.' },
    event_updated: { title: 'Event changed', body: '“{event}” has new details. Check the time and place.' },
    event_cancelled: { title: 'Event cancelled', body: '“{event}” was cancelled.' },
    event_promoted: { title: 'You’re in', body: 'A place opened up: you’re now going to “{event}”.' },
    material_ready: { title: 'Material ready', body: '“{title}” is processed and ready for students.' },
    material_failed: {
      title: 'Material needs attention',
      body: '“{title}” could not be processed. Open it to see why and try again.',
    },
    material_review: { title: 'Material to review', body: '{name} shared “{title}” for review.' },
    material_reviewed: { title: 'Review decision', body: '“{title}” was {decision}.' },
    ai_key_invalid: {
      title: 'AI key rejected',
      body: 'The AI provider rejected your college’s key. Students see passages from the material instead of answers until you replace it.',
    },
    ai_budget_warning: {
      title: 'AI budget {percent}% used',
      body: 'The study assistant has used {percent}% of this month’s token budget.',
    },
    ai_budget_reached: {
      title: 'AI budget used up',
      body: 'This month’s token budget is used. Students see passages from the material instead of answers until the 1st, or until you raise the budget.',
    },
    adult_now: {
      title: 'You’re 18 now',
      body: 'Your account works like every adult member’s. You can now choose who sees your contact details.',
    },
    guardian_number_approved: {
      title: 'Your college checked the number',
      body: 'Your guardian’s number is on your college record now. Send them the code to finish.',
    },
    guardian_number_rejected: {
      title: 'Your college couldn’t use that number',
      body: 'Your college couldn’t confirm the guardian number you entered. Check it with your college office, or enter another.',
    },
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
    roadmap_nudge: {
      title: 'మీ వారపు రోడ్‌మ్యాప్ లక్ష్యం',
      body: 'ఈ వారం “{roadmap}” లో ఒక చిన్న అడుగు వేస్తే మీరు ట్రాక్‌లో ఉంటారు.',
    },
    roadmap_approved: {
      title: 'రోడ్‌మ్యాప్ ప్రచురించబడింది',
      body: '{name} “{roadmap}” లో మీ మార్పులను ఆమోదించారు.',
    },
    roadmap_changes_requested: {
      title: 'రోడ్‌మ్యాప్ సమీక్ష',
      body: '{name} “{roadmap}” లో మార్పులు అడిగారు.',
    },
    badge_earned: {
      title: 'కొత్త బ్యాడ్జ్',
      body: 'మీకు కొత్త బ్యాడ్జ్ వచ్చింది. చూడటానికి మీ పురోగతి తెరవండి.',
    },
    redemption_decided: { title: 'రివార్డ్ అప్‌డేట్', body: '“{reward}” కోసం మీ అభ్యర్థన {decision}.' },
    event_reminder: { title: 'ఈవెంట్ గుర్తు', body: '“{event}” {time} కి మొదలవుతుంది.' },
    event_updated: { title: 'ఈవెంట్ మారింది', body: '“{event}” వివరాలు మారాయి. సమయం, స్థలం చూడండి.' },
    event_cancelled: { title: 'ఈవెంట్ రద్దయింది', body: '“{event}” రద్దు చేయబడింది.' },
    event_promoted: {
      title: 'మీకు చోటు దొరికింది',
      body: 'ఒక చోటు ఖాళీ అయింది: మీరు ఇప్పుడు “{event}” కి వెళ్తున్నారు.',
    },
    material_ready: {
      title: 'సామగ్రి సిద్ధం',
      body: '“{title}” ప్రాసెస్ అయింది, విద్యార్థులకు సిద్ధంగా ఉంది.',
    },
    material_failed: {
      title: 'సామగ్రిని పరిశీలించండి',
      body: '“{title}”ను ప్రాసెస్ చేయలేకపోయాము. కారణం చూసి మళ్ళీ ప్రయత్నించడానికి తెరవండి.',
    },
    material_review: { title: 'సమీక్షించాల్సిన సామగ్రి', body: '{name} సమీక్ష కోసం “{title}” పంచుకున్నారు.' },
    material_reviewed: { title: 'సమీక్ష నిర్ణయం', body: '“{title}” {decision}.' },
    ai_key_invalid: {
      title: 'AI కీ తిరస్కరించబడింది',
      body: 'AI ప్రొవైడర్ మీ కళాశాల కీని తిరస్కరించింది. మీరు దాన్ని మార్చే వరకు విద్యార్థులకు సమాధానాలకు బదులుగా సామగ్రిలోని భాగాలు కనిపిస్తాయి.',
    },
    ai_budget_warning: {
      title: 'AI బడ్జెట్ {percent}% వాడబడింది',
      body: 'స్టడీ అసిస్టెంట్ ఈ నెల టోకెన్ బడ్జెట్‌లో {percent}% వాడింది.',
    },
    ai_budget_reached: {
      title: 'AI బడ్జెట్ పూర్తయింది',
      body: 'ఈ నెల టోకెన్ బడ్జెట్ పూర్తయింది. 1వ తేదీ వరకు, లేదా మీరు బడ్జెట్ పెంచే వరకు, విద్యార్థులకు సమాధానాలకు బదులుగా సామగ్రిలోని భాగాలు కనిపిస్తాయి.',
    },
    adult_now: {
      title: 'మీకు ఇప్పుడు 18 ఏళ్లు',
      body: 'మీ ఖాతా ఇప్పుడు ఇతర పెద్దల సభ్యుల ఖాతాల లాగే పనిచేస్తుంది. మీ సంప్రదింపు వివరాలు ఎవరు చూడాలో మీరే ఎంచుకోవచ్చు.',
    },
    guardian_number_approved: {
      title: 'మీ కాలేజీ నంబర్‌ను తనిఖీ చేసింది',
      body: 'మీ సంరక్షకుల నంబర్ ఇప్పుడు మీ కాలేజీ రికార్డులో ఉంది. పూర్తి చేయడానికి వారికి కోడ్ పంపండి.',
    },
    guardian_number_rejected: {
      title: 'ఆ నంబర్‌ను మీ కాలేజీ వాడలేకపోయింది',
      body: 'మీరు ఇచ్చిన సంరక్షకుల నంబర్‌ను మీ కాలేజీ నిర్ధారించలేకపోయింది. మీ కాలేజీ ఆఫీసులో అడగండి, లేదా వేరే నంబర్ ఇవ్వండి.',
    },
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
    roadmap: 'roadmap',
    roadmap_comment: 'roadmap comment',
    event: 'event',
    event_question: 'event question',
  },
  te: {
    post: 'పోస్ట్',
    comment: 'కామెంట్',
    question: 'ప్రశ్న',
    answer: 'సమాధానం',
    story: 'స్టోరీ',
    item: 'అంశం',
    job: 'ఉద్యోగ పోస్ట్',
    roadmap: 'రోడ్‌మ్యాప్',
    roadmap_comment: 'రోడ్‌మ్యాప్ వ్యాఖ్య',
    event: 'ఈవెంట్',
    event_question: 'ఈవెంట్ ప్రశ్న',
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
    case 'roadmap':
    case 'roadmap_comment':
      return data.slug ? `/roadmaps/${data.slug}` : '/roadmaps';
    case 'event':
    case 'event_question':
      return data.eventId ? `/events/${data.eventId}` : '/events';
    default:
      return '/home';
  }
}

const FOOTER: Record<Locale, string> = {
  en: 'You can change which notifications you get in Settings → Notifications.',
  te: 'మీకు ఏ నోటిఫికేషన్లు రావాలో సెట్టింగ్స్ → నోటిఫికేషన్స్‌లో మార్చుకోవచ్చు.',
};
const OPEN: Record<Locale, string> = { en: 'Open', te: 'తెరవండి' };
const DECISION: Record<Locale, Record<string, string>> = {
  en: {
    fulfilled: 'fulfilled',
    rejected: 'declined (your points were returned)',
    published: 'published',
    not_published: 'not published',
  },
  te: {
    fulfilled: 'పూర్తయింది',
    rejected: 'తిరస్కరించబడింది (మీ పాయింట్లు తిరిగి ఇచ్చాం)',
    published: 'ప్రచురించబడింది',
    not_published: 'ప్రచురించబడలేదు',
  },
};

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
    case 'badge_earned':
      return '/progress';
    case 'redemption_decided':
      return '/rewards';
    case 'event_reminder':
    case 'event_updated':
    case 'event_cancelled':
    case 'event_promoted':
      return data.eventId ? `/events/${data.eventId}` : '/events';
    case 'roadmap_nudge':
    case 'roadmap_approved':
    case 'roadmap_changes_requested':
      return data.slug ? `/roadmaps/${data.slug}` : '/roadmaps';
    case 'material_ready':
    case 'material_failed':
    case 'material_reviewed':
      return data.subjectId && data.materialId ? `/study/${data.subjectId}/m/${data.materialId}` : '/study';
    case 'material_review':
      return data.subjectId ? `/study/${data.subjectId}?review=1` : '/study';
    case 'ai_key_invalid':
    case 'ai_budget_warning':
    case 'ai_budget_reached':
      return '/admin/ai';
    case 'adult_now':
      return '/settings/privacy';
    case 'guardian_number_approved':
      return '/verify';
    case 'guardian_number_rejected':
      return '/verify';
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
      .replace('{alert}', data.alert ?? '')
      .replace('{roadmap}', data.roadmap ?? '')
      .replace('{reward}', data.reward ?? '')
      .replace('{event}', data.event ?? '')
      .replace('{title}', data.title ?? '')
      .replace('{decision}', DECISION[locale][data.decision ?? ''] ?? '');
  return { title: fill(t.title), body: fill(t.body), footer: FOOTER[locale], open: OPEN[locale] };
}
