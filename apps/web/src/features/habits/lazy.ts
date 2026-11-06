import { loadPack } from '../../i18n';
import { lazyPart } from '../../lib/lazy-part';

/**
 * Prompt 2, G7: the voice Q&A controls, loaded with the `habits` pack only
 * on the screens that show them (Q&A stays within their size budget). Parts, so a load that fails
 * offline leaves the screen as it is and retries when the connection returns.
 */
const voice = () => Promise.all([import('./voice'), loadPack('habits')]).then(([m]) => m);
export const LazyVoiceAsk = lazyPart(() => voice().then((m) => m.VoiceAskButton));
export const LazyVoiceAnswer = lazyPart(() => voice().then((m) => m.VoiceAnswerButton));
export const LazyVoiceNote = lazyPart(() => voice().then((m) => m.VoiceNote));
