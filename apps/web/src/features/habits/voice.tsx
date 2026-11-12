import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Mic, Pencil, Square } from 'lucide-react';
import { VOICE_MAX_SECONDS, type AnswerView, type QuestionView, type VoiceInfo } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Input, Textarea } from '../../components/ui/field';
import { Badge } from '../../components/ui/misc';
import { Switch } from '../../components/ui/switch';
import { api, ApiError } from '../../lib/api';
import { useFileUrl } from '../../lib/files';
import { toast } from '../../lib/toast';
import { useRecorder } from '../interviews/use-recorder';

const seconds = (ms: number) => `0:${String(Math.floor(ms / 1000)).padStart(2, '0')}`;
const extOf = (audio: Blob) =>
  audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm';

/** Record up to a minute, choose whether to keep the audio, send it (prompt 2, G7; E3: text is always possible). */
function Recorder({ onSend, sending }: { onSend: (audio: Blob, keep: boolean) => void; sending: boolean }) {
  const { t } = useTranslation();
  const [keep, setKeep] = useState(false);
  const [audio, setAudio] = useState<Blob | null>(null);
  const recorder = useRecorder(setAudio, VOICE_MAX_SECONDS * 1000);
  if (recorder.state === 'unsupported')
    return <p className="text-callout text-fg-2">{t('habits.voice.unsupported')}</p>;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {recorder.state === 'recording' ? (
          <Button variant="danger" size="lg" onClick={recorder.stop}>
            <Square className="size-4" aria-hidden />{' '}
            {t('habits.voice.stop', { time: seconds(recorder.elapsed) })}
          </Button>
        ) : (
          <Button variant="secondary" size="lg" onClick={() => void recorder.start()} disabled={sending}>
            <Mic className="size-5" aria-hidden />{' '}
            {audio ? t('habits.voice.again') : t('habits.voice.record')}
          </Button>
        )}
        <span className="text-caption text-fg-3">{t('habits.voice.limit', { n: VOICE_MAX_SECONDS })}</span>
      </div>
      {(recorder.state === 'denied' || recorder.state === 'failed') && (
        <p role="alert" className="text-callout text-warning-ink">
          {t(`habits.voice.${recorder.state}`)}
        </p>
      )}
      {audio && recorder.state !== 'recording' && <p className="text-callout">{t('habits.voice.ready')}</p>}
      <Switch
        checked={keep}
        onChange={setKeep}
        label={t('habits.voice.keep')}
        description={t('habits.voice.keepBody')}
      />
      <div>
        <Button
          variant="primary"
          disabled={!audio || recorder.state === 'recording'}
          loading={sending}
          onClick={() => audio && onSend(audio, keep)}
        >
          {t('habits.voice.send')}
        </Button>
      </div>
    </div>
  );
}

/** "Ask by voice" on the questions page (and in a circle). */
export function VoiceAskButton({ circleId }: { circleId?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const send = useMutation({
    mutationFn: ({ audio, keep }: { audio: Blob; keep: boolean }) => {
      const form = new FormData();
      form.append('audio', audio, `question.${extOf(audio)}`);
      const qs = new URLSearchParams({ keepAudio: String(keep), ...(circleId ? { circleId } : {}) });
      return api.upload<QuestionView>(`/questions/voice?${qs.toString()}`, form);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['questions'] });
      toast.success(t('habits.voice.askSent'));
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Mic className="size-4" aria-hidden /> {t('habits.voice.ask')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('habits.voice.askTitle')}
        description={t('habits.voice.askBody')}
      >
        {open && <Recorder sending={send.isPending} onSend={(audio, keep) => send.mutate({ audio, keep })} />}
      </Dialog>
    </>
  );
}

/** "Answer by voice" on a question page. */
export function VoiceAnswerButton({ questionId }: { questionId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const send = useMutation({
    mutationFn: ({ audio, keep }: { audio: Blob; keep: boolean }) => {
      const form = new FormData();
      form.append('audio', audio, `answer.${extOf(audio)}`);
      return api.upload<AnswerView>(`/questions/${questionId}/answers/voice?keepAudio=${String(keep)}`, form);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['question', questionId] });
      toast.success(t('habits.voice.answerSent'));
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Mic className="size-4" aria-hidden /> {t('habits.voice.answer')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('habits.voice.answerTitle')}
        description={t('habits.voice.answerBody')}
      >
        {open && <Recorder sending={send.isPending} onSend={(audio, keep) => send.mutate({ audio, keep })} />}
      </Dialog>
    </>
  );
}

function Player({ fileId }: { fileId: string }) {
  const { t } = useTranslation();
  const src = useFileUrl(fileId);
  if (!src) return null;
  return (
    // The transcript beside it is the text alternative.
    <audio
      controls
      preload="none"
      src={src}
      className="h-11 w-full max-w-sm"
      aria-label={t('habits.voice.play')}
    />
  );
}

/**
 * Under a voice question or answer: its state, the kept recording (when the author kept it) and,
 * for the author, "Fix the transcript" (or type what could not be heard).
 */
export function VoiceNote({
  voice,
  kind,
  id,
  mine,
  title,
  body,
  questionId,
}: {
  voice: VoiceInfo;
  kind: 'question' | 'answer';
  id: string;
  mine: boolean;
  title?: string;
  body: string;
  questionId: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [newTitle, setNewTitle] = useState(title ?? '');
  const [newBody, setNewBody] = useState(voice.state === 'voice_failed' && kind === 'answer' ? '' : body);
  const save = useMutation({
    mutationFn: () =>
      api.put(kind === 'question' ? `/questions/${id}/transcript` : `/answers/${id}/transcript`, {
        ...(kind === 'question' ? { title: newTitle.trim() } : {}),
        body: newBody.trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['question', questionId] });
      void qc.invalidateQueries({ queryKey: ['questions'] });
      toast.success(t('habits.voice.saved'));
      setEditing(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const ready = kind === 'question' ? newTitle.trim().length >= 10 : newBody.trim().length >= 10;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={voice.state === 'voice_failed' ? 'warning' : 'info'}>
          <Mic className="size-3" aria-hidden /> {t(`habits.voice.state.${voice.state}`)}
        </Badge>
        {mine && voice.state !== 'transcribing' && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden />{' '}
            {voice.state === 'voice_failed' ? t('habits.voice.typeIt') : t('habits.voice.fix')}
          </Button>
        )}
      </div>
      {voice.audioFileId && <Player fileId={voice.audioFileId} />}
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title={t('habits.voice.fixTitle')}
        description={t('habits.voice.fixBody')}
        footer={
          <div className="grid gap-2 sm:flex sm:flex-row-reverse">
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={!ready}
              onClick={() => save.mutate()}
            >
              {t('common.save')}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        }
      >
        <div className="grid gap-4">
          {kind === 'question' && (
            <Field label={t('habits.voice.question')}>
              {({ id: fid }) => (
                <Input
                  id={fid}
                  maxLength={150}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              )}
            </Field>
          )}
          <Field label={kind === 'question' ? t('habits.voice.details') : t('habits.voice.answerText')}>
            {({ id: fid }) => (
              <Textarea
                id={fid}
                rows={5}
                maxLength={kind === 'question' ? 2000 : 3000}
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
