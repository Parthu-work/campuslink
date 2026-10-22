import { randomBytes } from 'node:crypto';
import type { Segment } from '../extract/captions.js';
import { callJson, joinUrl, type ProviderConnection } from '../ai/provider.js';

/** Speech to timed text, for videos and audio without uploaded captions. */
export interface TranscriptionProvider {
  readonly id: string;
  transcribe(audio: Buffer, language: string | null): Promise<Segment[]>;
}

/** Builds a multipart/form-data body (safeFetch sends bytes; no streaming form library needed). */
export function multipart(
  fields: Record<string, string>,
  file: { field: string; name: string; type: string; data: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----study${randomBytes(12).toString('hex')}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields))
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

const toSegments = (rows: { start?: number; end?: number; text?: string }[] | undefined): Segment[] =>
  (rows ?? [])
    .map((s) => ({
      start: Math.round((s.start ?? 0) * 10) / 10,
      end: Math.round((s.end ?? s.start ?? 0) * 10) / 10,
      text: (s.text ?? '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((s) => s.text);

/**
 * A local Whisper service (the optional `whisper` Docker profile: openai-whisper-asr-webservice,
 * running faster-whisper). Platform-owned, so it may be on the private network.
 */
export class WhisperServiceTranscriber implements TranscriptionProvider {
  readonly id = 'whisper';
  constructor(private readonly conn: ProviderConnection) {}
  async transcribe(audio: Buffer, language: string | null) {
    const base = this.conn.baseUrl ?? '';
    const q = `asr?task=transcribe&output=json&encode=true${language ? `&language=${language}` : ''}`;
    const form = multipart({}, { field: 'audio_file', name: 'audio.mp3', type: 'audio/mpeg', data: audio });
    const r = await callJson<{ segments?: { start?: number; end?: number; text?: string }[] }>(
      this.conn,
      joinUrl(base, q),
      {
        method: 'POST',
        rawBody: form.body,
        headers: { 'content-type': form.contentType },
        timeoutMs: 30 * 60_000,
        maxBytes: 16 * 1024 * 1024,
      },
    );
    return toSegments(r.segments);
  }
}

/** OpenAI's transcription API with the college's own OpenAI key (only when it chose OpenAI). */
export class OpenAiTranscriber implements TranscriptionProvider {
  readonly id = 'openai';
  constructor(private readonly conn: ProviderConnection) {}
  async transcribe(audio: Buffer, language: string | null) {
    const form = multipart(
      {
        model: 'whisper-1',
        response_format: 'verbose_json',
        'timestamp_granularities[]': 'segment',
        ...(language ? { language } : {}),
      },
      { field: 'file', name: 'audio.mp3', type: 'audio/mpeg', data: audio },
    );
    const r = await callJson<{ segments?: { start?: number; end?: number; text?: string }[] }>(
      this.conn,
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        rawBody: form.body,
        headers: { 'content-type': form.contentType, authorization: `Bearer ${this.conn.apiKey ?? ''}` },
        timeoutMs: 15 * 60_000,
        maxBytes: 16 * 1024 * 1024,
      },
    );
    return toSegments(r.segments);
  }
}
