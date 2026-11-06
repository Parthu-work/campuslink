import type { Logger } from '../../../lib/logger.js';
import type { AiSettingsService } from '../ai-settings.service.js';
import type { AiUsageService } from '../ai-usage.service.js';
import type { MediaTools } from './tools.js';
import { OpenAiTranscriber, type TranscriptionProvider } from './transcribe.js';

/**
 * Short voice recordings to text (prompt 2, G7: voice Q&A), with the same providers as mock
 * interviews and study material (E3): the platform's Whisper service first, else OpenAI with the
 * college's own key when it turned transcription on. Usage is recorded under transcription.
 */
export interface VoiceTranscriber {
  available(): Promise<boolean>;
  /** The text heard (empty when nothing was), and the recording's length when it could be read. */
  transcribe(data: Buffer, userId: string): Promise<{ text: string; durationSec: number | null }>;
}

export function voiceTranscriber(d: {
  whisper: TranscriptionProvider | null;
  aiSettings: AiSettingsService;
  usage: AiUsageService;
  media: MediaTools;
  logger: Logger;
}): VoiceTranscriber {
  const provider = async (): Promise<TranscriptionProvider | null> => {
    if (d.whisper) return d.whisper;
    const rt = await d.aiSettings.runtime();
    if (!rt.settings.features.transcription) return null;
    const conn = d.aiSettings.openAiConnection(rt);
    return conn ? new OpenAiTranscriber(conn) : null;
  };
  return {
    available: async () => !!(await provider()),
    transcribe: async (data, userId) => {
      const p = await provider();
      if (!p) return { text: '', durationSec: null };
      const { durationSec } = await d.media.probe(data).catch(() => ({ durationSec: null }));
      const mp3 = await d.media.audio(data).catch(() => null);
      if (!mp3) return { text: '', durationSec };
      const segments = await p.transcribe(mp3, null).catch((err: unknown) => {
        d.logger.warn({ err }, 'voice transcription failed');
        return [];
      });
      await d.usage.record({ kind: 'transcription', model: `${p.id}:transcription`, userId, inputTokens: 0 });
      return {
        text: segments
          .map((s) => s.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
        durationSec,
      };
    },
  };
}
