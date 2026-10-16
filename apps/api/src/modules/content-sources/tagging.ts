import type { Branch, Topic } from '@campuslink/shared';

/** Keyword rules for automatic topic and branch tags (applied to title, snippet and categories). */
const TOPIC_RULES: [Topic, RegExp][] = [
  ['placements', /\b(placement|campus recruitment|hiring drive|recruitment drive)s?\b/i],
  ['internships', /\bintern(ship)?s?\b/i],
  ['higher-studies', /\b(m\.?tech|ms in|masters?|phd|gre|gmat|ielts|toefl|higher studies|study abroad)\b/i],
  ['gate', /\bGATE\b/],
  ['govt-exams', /\b(upsc|ssc|psc|ies|ese|isro|drdo|bhel|ongc|ntpc|psu|government exam|recruitment exam)\b/i],
  ['scholarships', /\b(scholarships?|fellowships?|stipend)\b/i],
  ['govt-schemes', /\b(scheme|yojana|ministry|cabinet|government of india|policy)\b/i],
  [
    'ai-ml',
    /\b(ai|artificial intelligence|machine learning|deep learning|llm|generative|neural network)s?\b/i,
  ],
  ['data', /\b(data science|analytics|data engineering|sql|big data|data analyst)\b/i],
  ['web-dev', /\b(javascript|typescript|react|frontend|front-end|web development|css|html|node\.?js)\b/i],
  ['cloud-devops', /\b(cloud|aws|azure|gcp|kubernetes|docker|devops|serverless)\b/i],
  ['cybersecurity', /\b(security|vulnerabilit(y|ies)|cyber|malware|encryption|privacy)\b/i],
  ['dsa', /\b(algorithms?|data structures?|leetcode|competitive programming|dsa)\b/i],
  ['electronics', /\b(semiconductor|vlsi|chip|embedded|electronics|iot|5g)\b/i],
  ['electrical', /\b(power grid|electrical|renewable|solar|battery|ev charging|transmission)\b/i],
  ['mechanical', /\b(mechanical|automotive|robotics|manufacturing|cad|thermal)\b/i],
  ['civil', /\b(civil engineering|construction|infrastructure|structural|bridge|highway)\b/i],
  ['chemical', /\b(chemical engineering|process engineering|petrochemical|polymer|refinery)\b/i],
  ['startups', /\b(startup|founder|funding round|venture|incubat)/i],
  ['events', /\b(hackathon|webinar|conference|workshop|fest|summit)s?\b/i],
];
const BRANCH_RULES: [Branch, RegExp][] = [
  ['CSE', /\b(software|programming|computer science|developer|coding|ai|machine learning)\b/i],
  ['ECE', /\b(electronics|semiconductor|vlsi|embedded|communication|5g|signal)\b/i],
  ['EEE', /\b(electrical|power|renewable|solar|grid|ev)\b/i],
  ['MECH', /\b(mechanical|automotive|manufacturing|robotics|thermal)\b/i],
  ['CIVIL', /\b(civil|construction|structural|infrastructure)\b/i],
  ['CHEM', /\b(chemical|petrochemical|polymer|refinery)\b/i],
];

export function autoTags(text: string, defaults: { topics: Topic[]; branches: Branch[] }) {
  const topics = new Set<Topic>(defaults.topics);
  for (const [t, re] of TOPIC_RULES) if (re.test(text)) topics.add(t);
  const branches = new Set<Branch>(defaults.branches);
  for (const [b, re] of BRANCH_RULES) if (re.test(text)) branches.add(b);
  return { topics: [...topics].slice(0, 5), branches: [...branches].slice(0, 4) };
}
