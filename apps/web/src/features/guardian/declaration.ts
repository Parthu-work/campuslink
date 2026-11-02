import type { Locale } from '@campuslink/shared';

/**
 * The guardian's declaration (consent purpose `guardian_consent`, GUARDIAN_CONSENT.version). It is a
 * versioned legal text, not interface copy: the guardian reads it in the language they choose,
 * whatever the member's own language, so every language's version ships together. Change the wording only with
 * a new version (packages/shared/src/consent.ts) and legal review (docs/privacy.md).
 */
export const GUARDIAN_DECLARATION = {
  version: 1,
  en: [
    'I am the parent or lawful guardian of this student.',
    'I agree that the college may use this app for them: their profile, college verification, mentorship with verified alumni and staff, study material and placement information.',
    'While they are under 18, the app keeps their contact details private, does not rank their feed, keeps them off leaderboards and does not count them in usage statistics.',
    'I can withdraw this consent at any time by asking the college to close the account.',
  ],
  te: [
    'నేను ఈ విద్యార్థి తల్లి/తండ్రి లేదా చట్టబద్ధమైన సంరక్షకుడిని.',
    'కాలేజీ ఈ యాప్‌ను వారి కోసం ఉపయోగించడానికి నేను అంగీకరిస్తున్నాను: వారి ప్రొఫైల్, కాలేజీ ధృవీకరణ, ధృవీకరించిన పూర్వ విద్యార్థులు మరియు సిబ్బందితో మెంటర్‌షిప్, చదువు సామగ్రి మరియు ప్లేస్‌మెంట్ సమాచారం.',
    'వారికి 18 ఏళ్లు నిండే వరకు యాప్ వారి సంప్రదింపు వివరాలను గోప్యంగా ఉంచుతుంది, వారి ఫీడ్‌ను ర్యాంక్ చేయదు, లీడర్‌బోర్డ్‌లలో చూపించదు, వినియోగ గణాంకాల్లో లెక్కించదు.',
    'ఖాతాను మూసివేయమని కాలేజీని అడగడం ద్వారా నేను ఎప్పుడైనా ఈ అంగీకారాన్ని ఉపసంహరించుకోవచ్చు.',
  ],
  // Needs a native speaker's and a lawyer's review before use (docs/build/translation-review.md).
  hi: [
    'मैं इस विद्यार्थी का/की माता-पिता या कानूनी अभिभावक हूँ।',
    'मैं सहमति देता/देती हूँ कि कॉलेज उनके लिए इस ऐप का उपयोग कर सकता है: उनकी प्रोफ़ाइल, कॉलेज सत्यापन, सत्यापित पूर्व छात्रों और स्टाफ़ के साथ मेंटरशिप, अध्ययन सामग्री और प्लेसमेंट की जानकारी।',
    'जब तक वे 18 वर्ष से कम उम्र के हैं, ऐप उनके संपर्क विवरण निजी रखता है, उनकी फ़ीड को रैंक नहीं करता, उन्हें लीडरबोर्ड पर नहीं दिखाता और उपयोग के आँकड़ों में उनकी गिनती नहीं करता।',
    'मैं कॉलेज से खाता बंद करने के लिए कहकर किसी भी समय यह सहमति वापस ले सकता/सकती हूँ।',
  ],
} as const satisfies Record<Locale, readonly string[]> & { version: number };
export type DeclarationLanguage = Locale;
