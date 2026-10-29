/**
 * The guardian's declaration (consent purpose `guardian_consent`, GUARDIAN_CONSENT.version). It is a
 * versioned legal text, not interface copy: the guardian reads it in the language they choose,
 * whatever the member's own language, so both versions ship together. Change the wording only with
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
} as const;
export type DeclarationLanguage = 'en' | 'te';
