import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_LIMITS,
  deskFor,
  type SupportCategory,
  type SupportTicketView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { api, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/format';
import { toast } from '../../lib/toast';

/** Report a problem (B14): college matters go to the college, bugs to the platform team. */
export function ReportProblemDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [key] = useState(newIdempotencyKey);
  const [category, setCategory] = useState<SupportCategory>('account');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [shot, setShot] = useState<File | null>(null);
  const [error, setError] = useState('');
  const ready = subject.trim().length >= 4 && body.trim().length >= 10;
  const send = useMutation({
    mutationFn: async () => {
      let screenshotFileId: string | undefined;
      if (shot) {
        const form = new FormData();
        form.append('screenshot', shot);
        screenshotFileId = (await api.upload<{ id: string }>('/support/screenshots', form)).id;
      }
      return api.postOnce<SupportTicketView>(
        '/support/tickets',
        {
          category,
          subject: subject.trim(),
          body: body.trim(),
          ...(screenshotFileId ? { screenshotFileId } : {}),
        },
        key,
      );
    },
    onSuccess: (tk) => {
      toast.success(t('help.sent'));
      void qc.invalidateQueries({ queryKey: ['support-tickets'] });
      onClose();
      navigate(`/help/reports/${tk.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('help.reportTitle')}
      description={t(`help.goesTo.${deskFor(category)}`)}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            type="submit"
            form="report-form"
            loading={send.isPending}
            disabled={!ready}
          >
            {t('help.send')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <form
        id="report-form"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) send.mutate();
        }}
      >
        <Field label={t('help.categoryLabel')}>
          {({ id }) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as SupportCategory)}>
              {SUPPORT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`help.category.${c}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('help.subject')}>
          {({ id }) => (
            <Input
              id={id}
              maxLength={SUPPORT_LIMITS.subject}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('help.description')} hint={t('help.descriptionHint')}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={5}
              maxLength={SUPPORT_LIMITS.body}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('help.screenshot')}
          hint={t('help.screenshotHint', { mb: SUPPORT_LIMITS.screenshotMb })}
        >
          {({ id, describedBy }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="min-h-11 text-callout"
              onChange={(e) => setShot(e.target.files?.[0] ?? null)}
            />
          )}
        </Field>
        {error && (
          <p role="alert" className="text-callout text-danger-ink">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
