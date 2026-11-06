import { lazy } from 'react';
import { loadPack } from '../../i18n';

/**
 * Prompt 2, G7: the voice Q&A controls, loaded with the `habits` pack only
 * on the screens that show them (Q&A stays within their size budget).
 */
const voice = () => Promise.all([import('./voice'), loadPack('habits')]).then(([m]) => m);
export const LazyVoiceAsk = lazy(() => voice().then((m) => ({ default: m.VoiceAskButton })));
export const LazyVoiceAnswer = lazy(() => voice().then((m) => ({ default: m.VoiceAnswerButton })));
export const LazyVoiceNote = lazy(() => voice().then((m) => ({ default: m.VoiceNote })));
