import type { Branch, InterviewDifficulty } from '@campuslink/shared';

/**
 * The built-in starter bank (prompt 2, G3), written for campus interviews in India so a college
 * can practise from day one; faculty add their own through Admin › Interview questions. HR
 * questions are asked in English, Telugu or Hindi; technical questions are asked in English, as
 * campus technical rounds are, and the member may answer in any of the three.
 */
export interface StarterQuestion {
  id: string;
  track: 'hr' | 'technical';
  /** Technical questions: the branches they suit. */
  branches: readonly Branch[];
  difficulty: InterviewDifficulty;
  topic: string;
  text: { en: string; te?: string; hi?: string };
  rubric: string;
}

const SOFTWARE: readonly Branch[] = ['CSE', 'IT', 'AIML', 'DS'];
const ELECTRICAL: readonly Branch[] = ['ECE', 'EEE'];
const ANY: readonly Branch[] = [];

const hr = (
  n: number,
  difficulty: InterviewDifficulty,
  topic: string,
  text: StarterQuestion['text'],
  rubric: string,
): StarterQuestion => ({ id: `hr-${n}`, track: 'hr', branches: ANY, difficulty, topic, text, rubric });
const tech = (
  id: string,
  branches: readonly Branch[],
  difficulty: InterviewDifficulty,
  topic: string,
  en: string,
  rubric: string,
): StarterQuestion => ({ id, track: 'technical', branches, difficulty, topic, text: { en }, rubric });

export const STARTER_QUESTIONS: readonly StarterQuestion[] = [
  hr(
    1,
    'easy',
    'Introduction',
    {
      en: 'Tell me about yourself.',
      te: 'మీ గురించి చెప్పండి.',
      hi: 'अपने बारे में बताइए।',
    },
    'Two minutes or less: studies, one or two things they built or did, what they want next and why this kind of role. Not a recital of the résumé.',
  ),
  hr(
    2,
    'easy',
    'Motivation',
    {
      en: 'Why do you want to work in this field?',
      te: 'ఈ రంగంలో ఎందుకు పని చేయాలనుకుంటున్నారు?',
      hi: 'आप इस क्षेत्र में काम क्यों करना चाहते हैं?',
    },
    'A real reason tied to something they did (a project, an internship, a subject), not a general statement about the industry.',
  ),
  hr(
    3,
    'medium',
    'Teamwork',
    {
      en: 'Tell me about a time you worked in a team and something went wrong. What did you do?',
      te: 'టీమ్‌లో పని చేస్తున్నప్పుడు ఏదైనా సమస్య వచ్చిన సందర్భం చెప్పండి. మీరు ఏం చేశారు?',
      hi: 'कोई ऐसा समय बताइए जब आप टीम में काम कर रहे थे और कुछ गड़बड़ हुई। आपने क्या किया?',
    },
    'STAR: the situation, their own task, the actions they took (not "we"), and the result with what they learned.',
  ),
  hr(
    4,
    'medium',
    'Strengths and weaknesses',
    {
      en: 'What is one weakness you are working on, and how?',
      te: 'మీరు మెరుగుపరచుకుంటున్న ఒక బలహీనత ఏమిటి, ఎలా మెరుగుపరచుకుంటున్నారు?',
      hi: 'आप अपनी किस एक कमज़ोरी पर काम कर रहे हैं, और कैसे?',
    },
    'An honest, real weakness (not a disguised strength), a concrete step they are taking, and evidence it is improving.',
  ),
  hr(
    5,
    'medium',
    'Pressure',
    {
      en: 'Describe a time you had a deadline you could not meet. What happened?',
      te: 'మీరు గడువులోగా పని పూర్తి చేయలేకపోయిన సందర్భం చెప్పండి. ఏం జరిగింది?',
      hi: 'कोई ऐसा समय बताइए जब आप समय-सीमा पूरी नहीं कर पाए। क्या हुआ?',
    },
    'STAR: owns the miss, says what they told others and when, what they did to limit the damage, and what they do differently now.',
  ),
  hr(
    6,
    'easy',
    'Goals',
    {
      en: 'Where do you see yourself in three years?',
      te: 'మూడేళ్లలో మిమ్మల్ని మీరు ఎక్కడ చూస్తున్నారు?',
      hi: 'तीन साल बाद आप खुद को कहाँ देखते हैं?',
    },
    'A realistic plan linked to the role (skills they want to build, responsibility they want), without promising to leave or naming a title only.',
  ),
  hr(
    7,
    'medium',
    'Learning',
    {
      en: 'Tell me about something difficult you taught yourself. How did you go about it?',
      te: 'మీరు స్వయంగా నేర్చుకున్న కష్టమైన విషయం గురించి చెప్పండి. ఎలా నేర్చుకున్నారు?',
      hi: 'कोई कठिन चीज़ बताइए जो आपने खुद सीखी। आपने यह कैसे किया?',
    },
    'A specific skill, the sources and practice they used, a moment they were stuck and how they got past it, and how they used it after.',
  ),
  hr(
    8,
    'hard',
    'Conflict',
    {
      en: 'Tell me about a time you disagreed with a teacher, manager or teammate. How was it resolved?',
      te: 'టీచర్, మేనేజర్ లేదా సహచరుడితో మీరు విభేదించిన సందర్భం చెప్పండి. అది ఎలా పరిష్కారమైంది?',
      hi: 'कोई ऐसा समय बताइए जब आप किसी शिक्षक, मैनेजर या साथी से असहमत थे। मामला कैसे सुलझा?',
    },
    'STAR: respectful disagreement on facts, how they listened and made their case, the outcome even if they were overruled, and the relationship after.',
  ),
  hr(
    9,
    'easy',
    'Company',
    {
      en: 'What do you know about the company you are interviewing with, and why does it interest you?',
      te: 'మీరు ఇంటర్వ్యూకు వెళ్తున్న కంపెనీ గురించి మీకు ఏం తెలుసు, అది మీకు ఎందుకు ఆసక్తికరం?',
      hi: 'जिस कंपनी में आप इंटरव्यू दे रहे हैं उसके बारे में आप क्या जानते हैं, और वह आपको क्यों आकर्षित करती है?',
    },
    'Specific facts (what it makes or sells, its customers, a recent product or project) linked to their own interests. Honest if they know little.',
  ),
  hr(
    10,
    'hard',
    'Failure',
    {
      en: 'Tell me about a project that failed. What would you do differently?',
      te: 'విఫలమైన ఒక ప్రాజెక్టు గురించి చెప్పండి. మళ్లీ చేస్తే ఏం భిన్నంగా చేస్తారు?',
      hi: 'किसी ऐसे प्रोजेक्ट के बारे में बताइए जो असफल रहा। आप अब क्या अलग करेंगे?',
    },
    'STAR: a real failure, their share of the cause without blaming others, and a concrete change they would make.',
  ),
  hr(
    11,
    'medium',
    'Relocation and shifts',
    {
      en: 'Are you comfortable relocating or working in shifts? What matters to you here?',
      te: 'వేరే ఊరికి వెళ్లడం లేదా షిఫ్టుల్లో పని చేయడం మీకు సరేనా? మీకు ఇందులో ముఖ్యమైనది ఏమిటి?',
      hi: 'क्या आप दूसरी जगह जाने या शिफ्ट में काम करने के लिए तैयार हैं? आपके लिए इसमें क्या ज़रूरी है?',
    },
    'A clear, honest answer with any real constraint stated calmly, and flexibility where they have it.',
  ),
  hr(
    12,
    'easy',
    'Questions for us',
    {
      en: 'Do you have any questions for us?',
      te: 'మాకు ఏమైనా ప్రశ్నలు అడగాలనుకుంటున్నారా?',
      hi: 'क्या आप हमसे कुछ पूछना चाहते हैं?',
    },
    'One or two thoughtful questions about the work, the team or learning, not salary or leave first.',
  ),

  // Software: CSE, IT, AI and ML, data science.
  tech(
    'sw-1',
    SOFTWARE,
    'easy',
    'OOP',
    'Explain the difference between a class and an object, with an example from a project.',
    'A class is the definition, an object an instance with its own state; a concrete example; mentions constructors or fields.',
  ),
  tech(
    'sw-2',
    SOFTWARE,
    'medium',
    'Data structures',
    'When would you use a hash map instead of an array or a list? What does a lookup cost?',
    'Key-based lookup; average O(1) versus O(n) search; collisions; ordering not kept; memory trade-off.',
  ),
  tech(
    'sw-3',
    SOFTWARE,
    'medium',
    'Databases',
    'What is a database index, and when can it make things slower?',
    'A sorted structure (often a B-tree) that speeds reads; costs on writes and storage; low-selectivity columns; queries that cannot use it.',
  ),
  tech(
    'sw-4',
    SOFTWARE,
    'easy',
    'SQL',
    'What is the difference between an inner join and a left join?',
    'Inner keeps only matching rows; left keeps all rows of the left table with nulls where there is no match; an example.',
  ),
  tech(
    'sw-5',
    SOFTWARE,
    'hard',
    'Concurrency',
    'What is a race condition? How would you prevent one?',
    'Two threads or requests changing shared state in an order that breaks it; locks, atomic operations, transactions or avoiding shared state; an example.',
  ),
  tech(
    'sw-6',
    SOFTWARE,
    'medium',
    'Web',
    'What happens, step by step, when you type a URL into a browser and press Enter?',
    'DNS lookup, TCP and TLS, the HTTP request, the server response, parsing and rendering; caching mentioned.',
  ),
  tech(
    'sw-7',
    SOFTWARE,
    'medium',
    'Algorithms',
    'How would you find whether a list has duplicates? Give two approaches and their costs.',
    'Sorting then scanning (O(n log n)), a set (O(n) time and extra memory); the trade-off between them.',
  ),
  tech(
    'sw-8',
    SOFTWARE,
    'hard',
    'System design',
    'How would you design a URL shortener? Talk through the main parts.',
    'Generating short keys, storage, the redirect path, handling scale with caching, collisions, expiry and abuse.',
  ),
  tech(
    'sw-9',
    SOFTWARE,
    'medium',
    'Machine learning',
    'What is overfitting, and how do you detect and reduce it?',
    'Fits the training data but not new data; train versus validation error; more data, regularisation, simpler models, cross-validation.',
  ),
  tech(
    'sw-10',
    SOFTWARE,
    'easy',
    'Git',
    'What is the difference between git merge and git rebase?',
    'Merge keeps both histories with a merge commit; rebase replays commits on a new base for a linear history; do not rebase shared branches.',
  ),

  // Electronics and electrical: ECE, EEE.
  tech(
    'ee-1',
    ELECTRICAL,
    'easy',
    'Circuits',
    "State Ohm's law and Kirchhoff's two laws, and give one use of each.",
    'V = IR; current law at a node, voltage law around a loop; a simple worked use.',
  ),
  tech(
    'ee-2',
    ELECTRICAL,
    'medium',
    'Digital',
    'What is the difference between a latch and a flip-flop?',
    'A latch is level-sensitive, a flip-flop edge-triggered; where each is used; timing concerns.',
  ),
  tech(
    'ee-3',
    ELECTRICAL,
    'medium',
    'Semiconductors',
    'How does a MOSFET work as a switch?',
    'Gate voltage creates a channel between drain and source; threshold voltage; on and off regions; why it suits digital circuits.',
  ),
  tech(
    'ee-4',
    ELECTRICAL,
    'medium',
    'Signals',
    'What is the Nyquist sampling theorem, and what happens if you sample too slowly?',
    'Sample at more than twice the highest frequency; aliasing; anti-aliasing filters.',
  ),
  tech(
    'ee-5',
    ELECTRICAL,
    'hard',
    'Power',
    'Why is power transmitted at high voltage over long distances?',
    'Lower current for the same power, so lower I²R losses; transformers step up and down; insulation trade-off.',
  ),
  tech(
    'ee-6',
    ELECTRICAL,
    'medium',
    'Embedded',
    'What is an interrupt, and how is it different from polling?',
    'Hardware signals the processor which runs a handler; polling checks repeatedly; latency and power trade-offs; keeping handlers short.',
  ),
  tech(
    'ee-7',
    ELECTRICAL,
    'hard',
    'Machines',
    'Explain how an induction motor starts and why slip is needed.',
    'Rotating field induces rotor current; torque needs relative motion, so the rotor runs below synchronous speed; starting current.',
  ),

  // Mechanical.
  tech(
    'me-1',
    ['MECH'],
    'easy',
    'Thermodynamics',
    'State the first and second laws of thermodynamics in your own words.',
    'Energy is conserved (heat in equals work plus change in internal energy); entropy and why no engine is 100% efficient.',
  ),
  tech(
    'me-2',
    ['MECH'],
    'medium',
    'Materials',
    'What is the difference between stress and strain, and what does the stress-strain curve show?',
    'Force per area versus deformation; elastic region, yield, ultimate strength, fracture; ductile versus brittle.',
  ),
  tech(
    'me-3',
    ['MECH'],
    'medium',
    'Manufacturing',
    'Compare casting and forging. When would you choose each?',
    'Casting pours molten metal (complex shapes, lower strength); forging shapes solid metal (grain flow, strength); cost and volume.',
  ),
  tech(
    'me-4',
    ['MECH'],
    'medium',
    'Engines',
    'How is a four-stroke petrol engine different from a diesel engine?',
    'Spark versus compression ignition; compression ratios; fuel delivery; efficiency and uses.',
  ),
  tech(
    'me-5',
    ['MECH'],
    'hard',
    'Design',
    'How would you choose a factor of safety for a component?',
    'Uncertainty in loads and material, consequences of failure, standards, cost and weight; an example.',
  ),
  tech(
    'me-6',
    ['MECH'],
    'medium',
    'Fluids',
    "What does Bernoulli's equation say, and where does it not apply?",
    'Pressure, velocity and height energy along a streamline; assumes steady, incompressible, frictionless flow.',
  ),

  // Civil.
  tech(
    'ce-1',
    ['CIVIL'],
    'easy',
    'Concrete',
    'What affects the strength of concrete?',
    'Water-cement ratio, curing, mix proportions, aggregate quality, compaction; testing at 28 days.',
  ),
  tech(
    'ce-2',
    ['CIVIL'],
    'medium',
    'Structures',
    'What is the difference between a simply supported beam and a cantilever?',
    'Supports at both ends versus fixed at one; where bending moment and deflection are largest; examples.',
  ),
  tech(
    'ce-3',
    ['CIVIL'],
    'medium',
    'Soil',
    'Why is soil testing done before construction, and what tests would you expect?',
    'Bearing capacity, settlement, water table; standard penetration test, plate load, classification.',
  ),
  tech(
    'ce-4',
    ['CIVIL'],
    'medium',
    'Steel',
    'Why is steel added to concrete in reinforced concrete?',
    'Concrete is strong in compression and weak in tension; steel takes the tension; bond and cover.',
  ),
  tech(
    'ce-5',
    ['CIVIL'],
    'hard',
    'Project',
    'How would you plan the schedule for a small building project?',
    'Breaking work into activities, dependencies, the critical path, resources, weather and buffers; tracking progress.',
  ),

  // Chemical.
  tech(
    'ch-1',
    ['CHEM'],
    'easy',
    'Unit operations',
    'What is distillation, and what decides how well it separates two liquids?',
    'Separation by boiling points; relative volatility; reflux and stages; azeotropes.',
  ),
  tech(
    'ch-2',
    ['CHEM'],
    'medium',
    'Reactors',
    'Compare a batch reactor with a continuous stirred-tank reactor.',
    'Batch: varying composition over time, flexible; CSTR: steady state, uniform mixing, throughput; conversion trade-offs.',
  ),
  tech(
    'ch-3',
    ['CHEM'],
    'medium',
    'Heat transfer',
    'What are the three modes of heat transfer? Give a plant example of each.',
    'Conduction, convection, radiation, each with a realistic example such as exchangers or furnaces.',
  ),
  tech(
    'ch-4',
    ['CHEM'],
    'hard',
    'Safety',
    'What is a HAZOP study and why is it done?',
    'A structured review of deviations using guide words; causes, consequences and safeguards; before and during operation.',
  ),

  // Any branch (problem solving), also used when the branch has no technical set.
  tech(
    'gn-1',
    ANY,
    'easy',
    'Problem solving',
    'Walk me through how you would solve a problem you have never seen before.',
    'Clarify the goal, break it down, gather information, try and check, ask for help at the right time; an example.',
  ),
  tech(
    'gn-2',
    ANY,
    'medium',
    'Projects',
    'Explain your final-year or best project to someone outside your field.',
    'The problem, what they built, their own part, one technical decision and why, the result; plain language.',
  ),
  tech(
    'gn-3',
    ANY,
    'medium',
    'Estimation',
    'Roughly how many two-wheelers are there in your city? Talk through your estimate.',
    'States assumptions (population, households, ownership), structures the calculation, sanity-checks the result.',
  ),
  tech(
    'gn-4',
    ANY,
    'hard',
    'Trade-offs',
    'Tell me about a technical choice you made where both options had costs. How did you decide?',
    'The options, criteria, evidence used, the decision and what they would revisit.',
  ),
];
