import { APP_NAME, LOCALE_TAGS, type Locale } from '@campuslink/shared';
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
  hi: {
    quick_chat: 'क्विक चैट',
    video_1on1: '1:1 वीडियो कॉल',
    mock_interview: 'मॉक इंटरव्यू',
    resume_review: 'रिज़्यूमे रिव्यू',
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
    channel_budget_warning: {
      title: 'WhatsApp messages 80% used',
      body: 'This month’s WhatsApp allowance is {percent}% used. Members get push or email instead once it runs out.',
    },
    channel_budget_reached: {
      title: 'WhatsApp allowance used up',
      body: 'This month’s WhatsApp allowance is used. Until the 1st, members get push or email instead (codes and session reminders still go out).',
    },
    request_nudge: {
      title: '{name} is waiting for your reply',
      body: '{name} asked you for a session a day ago. Accept or decline so they can plan.',
    },
    request_rematch: {
      title: 'Mentors likely to reply soon',
      body: '{name} hasn’t replied yet. We found mentors who usually reply quickly; send them the same message in one tap.',
    },
    announcement: {
      title: 'From your college: {title}',
      body: 'Your college posted an announcement for you. Open it to read the details.',
    },
    drive_open: {
      title: '{company} is hiring: register by {time}',
      body: 'A new placement drive is open and you are eligible. Register in one tap before it closes.',
    },
    drive_reminder: {
      title: 'Last day to register for {company}',
      body: 'Registration for the {company} drive closes at {time}. You are eligible and not registered yet.',
    },
    drive_round_result: {
      title: '{company}: {round} result is out',
      body: 'Your result for the {round} round is in. Open the drive to see it and what comes next.',
    },
    drive_selected: {
      title: 'Congratulations: {company} selected you',
      body: 'You have an offer from {company}. It is on your placement record; open it to see the details.',
    },
    offer_verified: {
      title: 'Your {company} offer is verified',
      body: 'The placement cell verified the offer you reported. It now counts on your placement record.',
    },
    offer_rejected: {
      title: 'Your {company} offer needs another look',
      body: 'The placement cell could not verify the offer you reported. Open it to see why and report it again.',
    },
    outcome_verified: {
      title: 'Your outcome is verified: {title}',
      body: "The placement cell verified what you reported. It now counts on the college's record.",
    },
    outcome_rejected: {
      title: 'Your outcome needs another look: {title}',
      body: 'The placement cell could not verify what you reported. Open it to see why.',
    },
    invoice_issued: {
      title: 'New invoice {number}',
      body: 'Invoice {number} for {amount} is due on {due}. Download it in Admin › Billing.',
    },
    invoice_due_soon: {
      title: 'Invoice {number} is due on {due}',
      body: '{amount} is due on {due}. Pay by bank transfer quoting {number}, or online in Admin › Billing.',
    },
    invoice_due: {
      title: 'Invoice {number} is due today',
      body: '{amount} is due today. The bank details and the online option are in Admin › Billing.',
    },
    invoice_overdue: {
      title: 'Invoice {number} is overdue',
      body: '{amount} was due on {due}. If it is still unpaid 30 days after that, your college becomes read-only until it is paid. Nothing is deleted.',
    },
    college_read_only: {
      title: 'Your college is read-only',
      body: 'Invoice {number} is 30 days overdue. Members can still read and export everything, but nothing new can be added. Paying it restores everything at once.',
    },
    payment_received: {
      title: 'Payment received for {number}',
      body: 'We received {amount} for invoice {number}. Thank you.',
    },
    support_reply: {
      title: 'A reply to your problem report',
      body: 'Your college or the {app} team replied to a problem you reported. Open it to read the reply.',
    },
    support_ticket: {
      title: 'New problem report',
      body: 'A member reported a problem for the college to answer. Open Admin › Support to read it.',
    },
    weekly_digest: {
      title: 'Your week, {name}',
      body: '{drives} new drives you can register for, {requests} requests waiting for your reply, {sessions} sessions this week.',
    },
    account_inactive: {
      title: 'Your account will be deleted on {time}',
      body: 'You have not signed in for {months} months, so your college deletes your account on {time}. Sign in before then to keep it.',
    },
    resume_comment: {
      title: '{name} reviewed your résumé',
      body: '{name} left a comment on your résumé. Open it to read the review.',
    },
    micro_ask_received: {
      title: '{name} asked you a small favour',
      body: 'Something that fits in a few minutes. Open it to say yes or pass.',
    },
    micro_ask_done: {
      title: '{name} helped with your ask',
      body: '{name} marked your ask as done. Say thanks when you can.',
    },
    micro_ask_unmatched: {
      title: 'No alumnus is free for your ask yet',
      body: 'We tried the alumni who match. Try again later, or ask more widely.',
    },
    office_hours_scheduled: {
      title: '{name} holds office hours on {time}',
      body: '{event}: open it to say you are going.',
    },
    certificate_ready: {
      title: 'Your mentorship certificate is ready',
      body: 'Download it, or share its verification link.',
    },
    alumni_of_month_nominated: {
      title: 'You are nominated alumnus of the month',
      body: 'Your college wants to recognise you. Open it to accept or decline.',
    },
    pledge_received: {
      title: 'Your college received your contribution',
      body: 'Thank you. The acknowledgement is ready to download.',
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
    channel_budget_warning: {
      title: 'వాట్సాప్ సందేశాలు 80% వాడారు',
      body: 'ఈ నెల వాట్సాప్ పరిమితిలో {percent}% వాడారు. అది ముగిశాక సభ్యులకు బదులుగా పుష్ లేదా ఈమెయిల్ వస్తుంది.',
    },
    channel_budget_reached: {
      title: 'వాట్సాప్ పరిమితి పూర్తయింది',
      body: 'ఈ నెల వాట్సాప్ పరిమితి పూర్తయింది. 1వ తేదీ వరకు సభ్యులకు బదులుగా పుష్ లేదా ఈమెయిల్ వస్తుంది (కోడ్‌లు, సెషన్ రిమైండర్‌లు ఇంకా వెళ్తాయి).',
    },
    request_nudge: {
      title: '{name} మీ జవాబు కోసం ఎదురుచూస్తున్నారు',
      body: '{name} ఒక రోజు క్రితం మిమ్మల్ని సెషన్ అడిగారు. వారు ప్లాన్ చేసుకునేలా అంగీకరించండి లేదా తిరస్కరించండి.',
    },
    request_rematch: {
      title: 'త్వరగా జవాబిచ్చే మెంటర్లు',
      body: '{name} ఇంకా జవాబివ్వలేదు. సాధారణంగా త్వరగా జవాబిచ్చే మెంటర్లను కనుగొన్నాం; ఒక్క ట్యాప్‌తో అదే సందేశం వారికి పంపండి.',
    },
    announcement: {
      title: 'మీ కాలేజీ నుండి: {title}',
      body: 'మీ కాలేజీ మీ కోసం ఒక ప్రకటన చేసింది. వివరాలు చదవడానికి తెరవండి.',
    },
    drive_open: {
      title: '{company} నియామకం: {time} లోపు నమోదు చేసుకోండి',
      body: 'కొత్త ప్లేస్‌మెంట్ డ్రైవ్ తెరవబడింది, మీరు అర్హులు. ముగిసేలోపు ఒక్క ట్యాప్‌తో నమోదు చేసుకోండి.',
    },
    drive_reminder: {
      title: '{company}కి నమోదుకు చివరి రోజు',
      body: '{company} డ్రైవ్ నమోదు {time}కి ముగుస్తుంది. మీరు అర్హులు, ఇంకా నమోదు చేసుకోలేదు.',
    },
    drive_round_result: {
      title: '{company}: {round} ఫలితం వచ్చింది',
      body: '{round} రౌండ్‌లో మీ ఫలితం వచ్చింది. చూడటానికి, తర్వాత ఏమిటో తెలుసుకోవడానికి డ్రైవ్ తెరవండి.',
    },
    drive_selected: {
      title: 'అభినందనలు: {company} మిమ్మల్ని ఎంపిక చేసింది',
      body: 'మీకు {company} నుండి ఆఫర్ వచ్చింది. ఇది మీ ప్లేస్‌మెంట్ రికార్డ్‌లో ఉంది; వివరాలు చూడటానికి తెరవండి.',
    },
    offer_verified: {
      title: 'మీ {company} ఆఫర్ ధృవీకరించబడింది',
      body: 'మీరు నివేదించిన ఆఫర్‌ను ప్లేస్‌మెంట్ సెల్ ధృవీకరించింది. ఇప్పుడు ఇది మీ ప్లేస్‌మెంట్ రికార్డ్‌లో లెక్కించబడుతుంది.',
    },
    offer_rejected: {
      title: 'మీ {company} ఆఫర్‌ను మళ్లీ చూడాలి',
      body: 'మీరు నివేదించిన ఆఫర్‌ను ప్లేస్‌మెంట్ సెల్ ధృవీకరించలేకపోయింది. కారణం చూసి మళ్లీ నివేదించడానికి తెరవండి.',
    },
    outcome_verified: {
      title: 'మీ ఫలితం ధృవీకరించబడింది: {title}',
      body: 'మీరు నివేదించినదాన్ని ప్లేస్‌మెంట్ సెల్ ధృవీకరించింది. ఇది ఇప్పుడు కాలేజీ రికార్డ్‌లో లెక్కించబడుతుంది.',
    },
    outcome_rejected: {
      title: 'మీ ఫలితాన్ని మళ్లీ చూడాలి: {title}',
      body: 'మీరు నివేదించినదాన్ని ప్లేస్‌మెంట్ సెల్ ధృవీకరించలేకపోయింది. కారణం చూడటానికి తెరవండి.',
    },
    invoice_issued: {
      title: 'కొత్త ఇన్‌వాయిస్ {number}',
      body: '{amount} కోసం ఇన్‌వాయిస్ {number} గడువు {due}. అడ్మిన్ › బిల్లింగ్‌లో డౌన్‌లోడ్ చేసుకోండి.',
    },
    invoice_due_soon: {
      title: 'ఇన్‌వాయిస్ {number} గడువు {due}',
      body: '{amount} చెల్లింపు గడువు {due}. {number}ను రిఫరెన్స్‌గా ఇచ్చి బ్యాంక్ బదిలీ ద్వారా, లేదా అడ్మిన్ › బిల్లింగ్‌లో ఆన్‌లైన్‌లో చెల్లించండి.',
    },
    invoice_due: {
      title: 'ఇన్‌వాయిస్ {number} గడువు ఈ రోజు',
      body: '{amount} చెల్లింపు గడువు ఈ రోజు. బ్యాంక్ వివరాలు, ఆన్‌లైన్ చెల్లింపు అడ్మిన్ › బిల్లింగ్‌లో ఉన్నాయి.',
    },
    invoice_overdue: {
      title: 'ఇన్‌వాయిస్ {number} గడువు దాటింది',
      body: '{amount} గడువు {due}. ఆ తర్వాత 30 రోజులకూ చెల్లించకపోతే, చెల్లించే వరకు మీ కాలేజీ చదవడానికి మాత్రమే ఉంటుంది. ఏదీ తొలగించబడదు.',
    },
    college_read_only: {
      title: 'మీ కాలేజీ ఇప్పుడు చదవడానికి మాత్రమే',
      body: 'ఇన్‌వాయిస్ {number} గడువు దాటి 30 రోజులైంది. సభ్యులు అన్నీ చదవగలరు, ఎగుమతి చేయగలరు, కానీ కొత్తది ఏదీ జోడించలేరు. చెల్లించిన వెంటనే అన్నీ తిరిగి పనిచేస్తాయి.',
    },
    payment_received: {
      title: '{number}కు చెల్లింపు అందింది',
      body: 'ఇన్‌వాయిస్ {number}కు {amount} అందింది. ధన్యవాదాలు.',
    },
    support_reply: {
      title: 'మీ సమస్య నివేదికకు సమాధానం',
      body: 'మీరు నివేదించిన సమస్యకు మీ కాలేజీ లేదా {app} బృందం సమాధానం ఇచ్చింది. చదవడానికి దాన్ని తెరవండి.',
    },
    support_ticket: {
      title: 'కొత్త సమస్య నివేదిక',
      body: 'కాలేజీ సమాధానం ఇవ్వాల్సిన ఒక సమస్యను సభ్యులు నివేదించారు. చదవడానికి అడ్మిన్ › సపోర్ట్ తెరవండి.',
    },
    weekly_digest: {
      title: '{name}, మీ వారం',
      body: 'మీరు నమోదు చేయగల కొత్త డ్రైవ్‌లు {drives}, మీ జవాబు కోసం ఎదురుచూస్తున్న అభ్యర్థనలు {requests}, ఈ వారం సెషన్‌లు {sessions}.',
    },
    account_inactive: {
      title: 'మీ ఖాతా {time}న తొలగించబడుతుంది',
      body: 'మీరు {months} నెలలుగా సైన్ ఇన్ చేయలేదు, కాబట్టి మీ కాలేజీ {time}న మీ ఖాతాను తొలగిస్తుంది. దాన్ని ఉంచుకోవడానికి అంతకు ముందే సైన్ ఇన్ చేయండి.',
    },
    resume_comment: {
      title: '{name} మీ రెజ్యూమ్‌ను సమీక్షించారు',
      body: '{name} మీ రెజ్యూమ్‌పై వ్యాఖ్య రాశారు. సమీక్ష చదవడానికి తెరవండి.',
    },
    micro_ask_received: {
      title: '{name} మిమ్మల్ని ఒక చిన్న సహాయం అడిగారు',
      body: 'కొన్ని నిమిషాల్లో అయ్యే పని. అంగీకరించడానికి లేదా వదిలేయడానికి తెరవండి.',
    },
    micro_ask_done: {
      title: '{name} మీ అభ్యర్థనలో సహాయం చేశారు',
      body: '{name} మీ అభ్యర్థన పూర్తైనట్లు గుర్తించారు. వీలైనప్పుడు ధన్యవాదాలు చెప్పండి.',
    },
    micro_ask_unmatched: {
      title: 'మీ అభ్యర్థనకు ఇంకా ఏ పూర్వ విద్యార్థి ఖాళీగా లేరు',
      body: 'సరిపోయే పూర్వ విద్యార్థులను ప్రయత్నించాం. తర్వాత మళ్లీ ప్రయత్నించండి, లేదా విస్తృతంగా అడగండి.',
    },
    office_hours_scheduled: {
      title: '{name} {time}కి ఆఫీస్ అవర్స్ నిర్వహిస్తున్నారు',
      body: '{event}: వస్తున్నారని చెప్పడానికి తెరవండి.',
    },
    certificate_ready: {
      title: 'మీ మెంటార్‌షిప్ సర్టిఫికెట్ సిద్ధంగా ఉంది',
      body: 'డౌన్‌లోడ్ చేయండి, లేదా దాని ధృవీకరణ లింక్ పంచుకోండి.',
    },
    alumni_of_month_nominated: {
      title: 'మీరు ఈ నెల పూర్వ విద్యార్థిగా నామినేట్ అయ్యారు',
      body: 'మీ కాలేజీ మిమ్మల్ని గుర్తించాలనుకుంటోంది. అంగీకరించడానికి లేదా తిరస్కరించడానికి తెరవండి.',
    },
    pledge_received: {
      title: 'మీ కాలేజీకి మీ విరాళం అందింది',
      body: 'ధన్యవాదాలు. రసీదు డౌన్‌లోడ్‌కు సిద్ధంగా ఉంది.',
    },
  },
  hi: {
    request_received: { title: 'नया मेंटरशिप अनुरोध', body: '{name} ने आपसे {type} के लिए पूछा है।' },
    request_accepted: { title: 'अनुरोध स्वीकार हुआ', body: '{name} ने आपका {type} अनुरोध स्वीकार कर लिया।' },
    request_declined: { title: 'अनुरोध की जानकारी', body: '{name} अभी आपका अनुरोध नहीं ले सकते।' },
    request_expired: {
      title: 'अनुरोध की समय-सीमा खत्म',
      body: '{name} को भेजा आपका अनुरोध बिना जवाब के खत्म हो गया। आप किसी और मेंटर से पूछ सकते हैं।',
    },
    booking_rescheduled: { title: 'सत्र का समय बदला', body: '{name} ने आपका {type} {time} पर कर दिया।' },
    booking_cancelled: {
      title: 'सत्र रद्द हुआ',
      body: '{time} को {name} के साथ आपका {type} रद्द हो गया।',
    },
    booking_reminder: { title: 'सत्र की याद', body: '{name} के साथ आपका {type} {time} शुरू होगा।' },
    session_completed: { title: 'कैसा रहा?', body: '{name} के साथ अपने {type} को रेटिंग दें।' },
    feedback_received: { title: 'नया फ़ीडबैक', body: 'एक मेंटी ने आपके सत्र को रेटिंग दी।' },
    new_message: { title: 'नया संदेश', body: '{name} ने आपको संदेश भेजा।' },
    post_comment: { title: 'नई टिप्पणी', body: '{name} ने आपकी पोस्ट पर टिप्पणी की।' },
    comment_reply: { title: 'नया जवाब', body: '{name} ने आपकी टिप्पणी का जवाब दिया।' },
    question_answered: { title: 'नया उत्तर', body: '{name} ने आपके प्रश्न का उत्तर दिया।' },
    answer_accepted: { title: 'उत्तर स्वीकार हुआ', body: 'आपके उत्तर को सबसे अच्छा उत्तर चुना गया।' },
    question_approved: { title: 'प्रश्न प्रकाशित हुआ', body: 'आपका प्रश्न अब आपके कॉलेज को दिख रहा है।' },
    question_rejected: {
      title: 'प्रश्न प्रकाशित नहीं हुआ',
      body: 'मॉडरेटरों ने आपका प्रश्न प्रकाशित नहीं किया। कारण देखने के लिए इसे खोलें।',
    },
    content_removed: {
      title: 'सामग्री हटाई गई',
      body: 'मॉडरेटरों ने आपकी {content} हटा दी। कारण देखने के लिए इसे खोलें, और असहमत हों तो अपील करें।',
    },
    content_restored: { title: 'सामग्री वापस आई', body: 'आपकी {content} फिर से दिख रही है।' },
    appeal_decided: {
      title: 'अपील पर फ़ैसला',
      body: 'मॉडरेटरों ने आपकी {content} के बारे में आपकी अपील देखी।',
    },
    referral_received: { title: 'रेफ़रल अनुरोध', body: '{name} ने {company} में रेफ़रल के लिए पूछा है।' },
    referral_referred: { title: 'आपको रेफ़र किया गया', body: '{name} ने आपको {company} में रेफ़र किया।' },
    referral_declined: {
      title: 'रेफ़रल की जानकारी',
      body: '{name} अभी आपको {company} में रेफ़र नहीं कर सकते।',
    },
    referral_expired: {
      title: 'रेफ़रल अनुरोध की समय-सीमा खत्म',
      body: '{name} को भेजा आपका रेफ़रल अनुरोध बिना जवाब के खत्म हो गया।',
    },
    job_alert: { title: 'नई नौकरियाँ', body: 'नई नौकरियाँ आपके अलर्ट “{alert}” से मेल खाती हैं।' },
    roadmap_nudge: {
      title: 'आपका साप्ताहिक रोडमैप लक्ष्य',
      body: 'इस हफ़्ते “{roadmap}” पर एक छोटा कदम आपको सही राह पर रखेगा।',
    },
    roadmap_approved: {
      title: 'रोडमैप प्रकाशित हुआ',
      body: '{name} ने “{roadmap}” में आपके बदलाव स्वीकार किए।',
    },
    roadmap_changes_requested: {
      title: 'रोडमैप की समीक्षा',
      body: '{name} ने “{roadmap}” में बदलाव माँगे हैं।',
    },
    badge_earned: { title: 'नया बैज', body: 'आपने नया बैज कमाया। देखने के लिए अपनी प्रगति खोलें।' },
    redemption_decided: { title: 'इनाम की जानकारी', body: '“{reward}” के लिए आपका अनुरोध {decision}।' },
    event_reminder: { title: 'इवेंट की याद', body: '“{event}” {time} शुरू होगा।' },
    event_updated: { title: 'इवेंट बदला', body: '“{event}” की जानकारी बदली है। समय और जगह देख लें।' },
    event_cancelled: { title: 'इवेंट रद्द हुआ', body: '“{event}” रद्द हो गया।' },
    event_promoted: { title: 'आपकी जगह पक्की', body: 'एक जगह खाली हुई: अब आप “{event}” में जा रहे हैं।' },
    material_ready: {
      title: 'सामग्री तैयार',
      body: '“{title}” प्रोसेस हो गई है और विद्यार्थियों के लिए तैयार है।',
    },
    material_failed: {
      title: 'सामग्री पर ध्यान दें',
      body: '“{title}” प्रोसेस नहीं हो सकी। कारण देखने और फिर से कोशिश करने के लिए इसे खोलें।',
    },
    material_review: { title: 'समीक्षा के लिए सामग्री', body: '{name} ने “{title}” समीक्षा के लिए साझा की।' },
    material_reviewed: { title: 'समीक्षा का फ़ैसला', body: '“{title}” {decision}।' },
    ai_key_invalid: {
      title: 'AI कुंजी अस्वीकार हुई',
      body: 'AI प्रदाता ने आपके कॉलेज की कुंजी अस्वीकार कर दी। जब तक आप इसे नहीं बदलते, विद्यार्थियों को उत्तरों की जगह सामग्री के अंश दिखेंगे।',
    },
    ai_budget_warning: {
      title: 'AI बजट का {percent}% इस्तेमाल हुआ',
      body: 'स्टडी असिस्टेंट ने इस महीने के टोकन बजट का {percent}% इस्तेमाल कर लिया है।',
    },
    ai_budget_reached: {
      title: 'AI बजट खत्म',
      body: 'इस महीने का टोकन बजट खत्म हो गया। 1 तारीख तक, या बजट बढ़ाने तक, विद्यार्थियों को उत्तरों की जगह सामग्री के अंश दिखेंगे।',
    },
    adult_now: {
      title: 'अब आप 18 साल के हो गए',
      body: 'आपका खाता अब हर वयस्क सदस्य की तरह काम करता है। अब आप चुन सकते हैं कि आपके संपर्क विवरण कौन देखे।',
    },
    guardian_number_approved: {
      title: 'आपके कॉलेज ने नंबर जाँच लिया',
      body: 'आपके अभिभावक का नंबर अब आपके कॉलेज के रिकॉर्ड में है। पूरा करने के लिए उन्हें कोड भेजें।',
    },
    guardian_number_rejected: {
      title: 'आपका कॉलेज वह नंबर इस्तेमाल नहीं कर सका',
      body: 'आपका कॉलेज आपके दिए अभिभावक नंबर की पुष्टि नहीं कर सका। अपने कॉलेज ऑफ़िस से जाँचें, या दूसरा नंबर डालें।',
    },
    channel_budget_warning: {
      title: 'WhatsApp संदेशों का 80% इस्तेमाल हुआ',
      body: 'इस महीने की WhatsApp सीमा का {percent}% इस्तेमाल हो चुका है। सीमा खत्म होने पर सदस्यों को पुश या ईमेल मिलेगा।',
    },
    channel_budget_reached: {
      title: 'WhatsApp सीमा खत्म',
      body: 'इस महीने की WhatsApp सीमा खत्म हो गई। 1 तारीख तक सदस्यों को पुश या ईमेल मिलेगा (कोड और सत्र की याद फिर भी जाएँगे)।',
    },
    request_nudge: {
      title: '{name} आपके जवाब का इंतज़ार कर रहे हैं',
      body: '{name} ने एक दिन पहले आपसे सत्र माँगा था। स्वीकार या अस्वीकार करें ताकि वे योजना बना सकें।',
    },
    request_rematch: {
      title: 'जल्दी जवाब देने वाले मेंटर',
      body: '{name} ने अभी तक जवाब नहीं दिया। हमें ऐसे मेंटर मिले जो आमतौर पर जल्दी जवाब देते हैं; एक टैप में उन्हें वही संदेश भेजें।',
    },
    announcement: {
      title: 'आपके कॉलेज से: {title}',
      body: 'आपके कॉलेज ने आपके लिए एक घोषणा की है। जानकारी पढ़ने के लिए इसे खोलें।',
    },
    drive_open: {
      title: '{company} भर्ती कर रही है: {time} तक रजिस्टर करें',
      body: 'एक नई प्लेसमेंट ड्राइव खुली है और आप पात्र हैं। बंद होने से पहले एक टैप में रजिस्टर करें।',
    },
    drive_reminder: {
      title: '{company} के लिए रजिस्टर करने का आखिरी दिन',
      body: '{company} ड्राइव का रजिस्ट्रेशन {time} पर बंद होगा। आप पात्र हैं और अभी रजिस्टर नहीं किया है।',
    },
    drive_round_result: {
      title: '{company}: {round} का परिणाम आ गया',
      body: '{round} राउंड का आपका परिणाम आ गया है। इसे और आगे क्या है, देखने के लिए ड्राइव खोलें।',
    },
    drive_selected: {
      title: 'बधाई हो: {company} ने आपको चुना',
      body: 'आपके पास {company} का ऑफ़र है। यह आपके प्लेसमेंट रिकॉर्ड में है; जानकारी देखने के लिए इसे खोलें।',
    },
    offer_verified: {
      title: 'आपका {company} ऑफ़र सत्यापित हुआ',
      body: 'प्लेसमेंट सेल ने आपका बताया ऑफ़र सत्यापित कर दिया। अब यह आपके प्लेसमेंट रिकॉर्ड में गिना जाएगा।',
    },
    offer_rejected: {
      title: 'आपके {company} ऑफ़र को फिर से देखना होगा',
      body: 'प्लेसमेंट सेल आपका बताया ऑफ़र सत्यापित नहीं कर सका। कारण देखने और फिर से बताने के लिए इसे खोलें।',
    },
    outcome_verified: {
      title: 'आपका परिणाम सत्यापित हुआ: {title}',
      body: 'प्लेसमेंट सेल ने आपकी दी जानकारी सत्यापित कर दी। अब यह कॉलेज के रिकॉर्ड में गिनी जाएगी।',
    },
    outcome_rejected: {
      title: 'आपके परिणाम को फिर से देखना होगा: {title}',
      body: 'प्लेसमेंट सेल आपकी दी जानकारी सत्यापित नहीं कर सका। कारण देखने के लिए इसे खोलें।',
    },
    invoice_issued: {
      title: 'नया इनवॉइस {number}',
      body: '{amount} का इनवॉइस {number} {due} तक देय है। इसे एडमिन › बिलिंग में डाउनलोड करें।',
    },
    invoice_due_soon: {
      title: 'इनवॉइस {number} {due} तक देय है',
      body: '{amount} {due} तक देय है। {number} लिखकर बैंक ट्रांसफ़र से, या एडमिन › बिलिंग में ऑनलाइन भुगतान करें।',
    },
    invoice_due: {
      title: 'इनवॉइस {number} आज देय है',
      body: '{amount} आज देय है। बैंक विवरण और ऑनलाइन भुगतान का विकल्प एडमिन › बिलिंग में है।',
    },
    invoice_overdue: {
      title: 'इनवॉइस {number} की देय तिथि निकल गई',
      body: '{amount} {due} तक देय था। उसके 30 दिन बाद भी बकाया रहा, तो भुगतान होने तक आपका कॉलेज केवल पढ़ने के लिए रहेगा। कुछ भी हटाया नहीं जाएगा।',
    },
    college_read_only: {
      title: 'आपका कॉलेज अब केवल पढ़ने के लिए है',
      body: 'इनवॉइस {number} की देय तिथि को 30 दिन बीत गए। सदस्य अब भी सब कुछ पढ़ और एक्सपोर्ट कर सकते हैं, पर कुछ नया नहीं जोड़ सकते। भुगतान होते ही सब कुछ तुरंत वापस चालू हो जाएगा।',
    },
    payment_received: {
      title: '{number} का भुगतान मिला',
      body: 'हमें इनवॉइस {number} के लिए {amount} मिल गए। धन्यवाद।',
    },
    support_reply: {
      title: 'आपकी समस्या रिपोर्ट का जवाब',
      body: 'आपकी बताई समस्या पर आपके कॉलेज या {app} टीम ने जवाब दिया है। जवाब पढ़ने के लिए इसे खोलें।',
    },
    support_ticket: {
      title: 'नई समस्या रिपोर्ट',
      body: 'एक सदस्य ने कॉलेज के जवाब के लिए एक समस्या बताई है। इसे पढ़ने के लिए एडमिन › सपोर्ट खोलें।',
    },
    weekly_digest: {
      title: '{name}, आपका हफ़्ता',
      body: 'आप जिनमें पंजीकरण कर सकते हैं ऐसी नई ड्राइव {drives}, आपके जवाब का इंतज़ार कर रहे अनुरोध {requests}, इस हफ़्ते के सत्र {sessions}।',
    },
    account_inactive: {
      title: 'आपका खाता {time} को हटा दिया जाएगा',
      body: 'आपने {months} महीनों से साइन इन नहीं किया है, इसलिए आपका कॉलेज {time} को आपका खाता हटा देगा। इसे रखने के लिए उससे पहले साइन इन करें।',
    },
    resume_comment: {
      title: '{name} ने आपके रिज़्यूमे की समीक्षा की',
      body: '{name} ने आपके रिज़्यूमे पर टिप्पणी की है। समीक्षा पढ़ने के लिए खोलें।',
    },
    micro_ask_received: {
      title: '{name} ने आपसे एक छोटी मदद मांगी है',
      body: 'कुछ मिनटों का काम। हां कहने या छोड़ने के लिए खोलें।',
    },
    micro_ask_done: {
      title: '{name} ने आपके अनुरोध में मदद की',
      body: '{name} ने आपका अनुरोध पूरा बताया है। मौका मिलने पर धन्यवाद कहें।',
    },
    micro_ask_unmatched: {
      title: 'आपके अनुरोध के लिए अभी कोई पूर्व छात्र खाली नहीं है',
      body: 'हमने मेल खाते पूर्व छात्रों से पूछा। बाद में फिर कोशिश करें, या ज़्यादा लोगों से पूछें।',
    },
    office_hours_scheduled: {
      title: '{name} {time} को ऑफ़िस आवर्स रखेंगे',
      body: '{event}: आ रहे हैं यह बताने के लिए खोलें।',
    },
    certificate_ready: {
      title: 'आपका मेंटरशिप प्रमाणपत्र तैयार है',
      body: 'इसे डाउनलोड करें, या इसका सत्यापन लिंक साझा करें।',
    },
    alumni_of_month_nominated: {
      title: 'आपको इस महीने का पूर्व छात्र नामित किया गया है',
      body: 'आपका कॉलेज आपको सम्मानित करना चाहता है। स्वीकार या अस्वीकार करने के लिए खोलें।',
    },
    pledge_received: {
      title: 'आपके कॉलेज को आपका योगदान मिल गया',
      body: 'धन्यवाद। पावती डाउनलोड के लिए तैयार है।',
    },
  },
};

/** Every notification's text per language (a test checks the placeholders match English). */
export const NOTIFICATION_TEXTS = T;

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
  hi: {
    post: 'पोस्ट',
    comment: 'टिप्पणी',
    question: 'प्रश्न',
    answer: 'उत्तर',
    story: 'स्टोरी',
    item: 'सामग्री',
    job: 'नौकरी की पोस्ट',
    roadmap: 'रोडमैप',
    roadmap_comment: 'रोडमैप पर टिप्पणी',
    event: 'इवेंट',
    event_question: 'इवेंट का प्रश्न',
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
  hi: 'आपको कौन-सी सूचनाएँ मिलें, यह आप सेटिंग्स → सूचनाएँ में बदल सकते हैं।',
};
const OPEN: Record<Locale, string> = { en: 'Open', te: 'తెరవండి', hi: 'खोलें' };
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
  hi: {
    fulfilled: 'पूरा किया गया',
    rejected: 'अस्वीकार किया गया (आपके पॉइंट्स लौटा दिए गए)',
    published: 'प्रकाशित किया गया',
    not_published: 'प्रकाशित नहीं किया गया',
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
    case 'channel_budget_warning':
      return '/admin';
    case 'channel_budget_reached':
      return '/admin';
    case 'request_nudge':
      return `/mentorship?box=received${data.requestId ? `&request=${data.requestId}` : ''}`;
    case 'request_rematch':
      return `/mentorship?box=sent${data.requestId ? `&request=${data.requestId}` : ''}`;
    case 'announcement':
      return `/posts/${data.postId}`;
    case 'drive_open':
      return `/placements/${data.driveId}`;
    case 'drive_reminder':
      return `/placements/${data.driveId}`;
    case 'drive_round_result':
      return `/placements/${data.driveId}`;
    case 'drive_selected':
      return '/placements?tab=offers';
    case 'offer_verified':
      return '/outcomes';
    case 'offer_rejected':
      return '/outcomes';
    case 'outcome_verified':
      return '/outcomes';
    case 'outcome_rejected':
      return '/outcomes';
    case 'invoice_issued':
      return '/admin/billing';
    case 'invoice_due_soon':
      return '/admin/billing';
    case 'invoice_due':
      return '/admin/billing';
    case 'invoice_overdue':
      return '/admin/billing';
    case 'college_read_only':
      return '/admin/billing';
    case 'payment_received':
      return '/admin/billing';
    case 'support_reply':
      return `/help/reports/${data.ticketId ?? ''}`;
    case 'support_ticket':
      return `/admin/support?report=${data.ticketId ?? ''}`;
    case 'weekly_digest':
      return '/home';
    case 'account_inactive':
      return '/settings/privacy';
    case 'resume_comment':
      return `/resume/${data.resumeId ?? ''}`;
    case 'micro_ask_received':
      return `/alumni?tab=asks&box=received${data.askId ? `&ask=${data.askId}` : ''}`;
    case 'micro_ask_done':
      return '/alumni?tab=asks';
    case 'micro_ask_unmatched':
      return '/alumni?tab=asks';
    case 'office_hours_scheduled':
      return `/events/${data.eventId ?? ''}`;
    case 'certificate_ready':
      return '/alumni?tab=certificates';
    case 'alumni_of_month_nominated':
      return '/alumni?tab=recognition';
    case 'pledge_received':
      return '/alumni?tab=giving';
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
    ? new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(data.start))
    : '';
  const fill = (s: string) =>
    s
      .replace('{app}', APP_NAME)
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
      .replace('{decision}', DECISION[locale][data.decision ?? ''] ?? '')
      // Any other placeholder ({percent}, {count}, …) is a plain value from the data.
      .replace(/\{(\w+)\}/g, (_m, k: string) => data[k] ?? '');
  return { title: fill(t.title), body: fill(t.body), footer: FOOTER[locale], open: OPEN[locale] };
}
