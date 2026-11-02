import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { DRIVE_ROLE_TYPES, type DriveRoleType, type OfferView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Input, Select } from '../../components/ui/field';
import { api, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/format';
import { toast } from '../../lib/toast';

const SOURCES = ['off_campus', 'ppo', 'internship_conversion'] as const;
type Source = (typeof SOURCES)[number];
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Report an offer the placement cell did not record (off campus, PPO, internship conversion),
 * with proof: a PDF or a photo of the letter, rebuilt and stripped of metadata by the server.
 */
export function OfferReportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [key] = useState(newIdempotencyKey);
  const [companyName, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [ctc, setCtc] = useState('');
  const [date, setDate] = useState(today);
  const [type, setType] = useState<DriveRoleType>('full_time');
  const [source, setSource] = useState<Source>('off_campus');
  const [proof, setProof] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const form = new FormData();
      form.append('file', f);
      return { r: await api.upload<{ id: string }>('/placements/offers/proof', form), name: f.name };
    },
    onSuccess: ({ r, name }) => {
      setError('');
      setProof({ id: r.id, name });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const send = useMutation({
    mutationFn: () =>
      api.postOnce<OfferView>(
        '/placements/offers',
        {
          companyName: companyName.trim(),
          role: role.trim(),
          ctcLpa: Number(ctc),
          offerDate: new Date(`${date}T12:00:00`).toISOString(),
          type,
          source,
          proofFileId: proof?.id ?? '',
        },
        key,
      ),
    onSuccess: () => {
      toast.success(t('placements.offerReported'));
      void qc.invalidateQueries({ queryKey: ['my-offers'] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const ready = companyName.trim().length >= 2 && role.trim().length >= 2 && Number(ctc) > 0 && !!proof;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('placements.reportOffer')}
      description={t('placements.reportOfferBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            type="submit"
            form="offer-report"
            loading={send.isPending}
            disabled={!ready}
          >
            {t('placements.sendForVerification')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <form
        id="offer-report"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) send.mutate();
        }}
      >
        <Field label={t('placements.field.company')}>
          {({ id }) => (
            <Input
              id={id}
              required
              maxLength={120}
              value={companyName}
              onChange={(e) => setCompany(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('placements.field.role')}>
          {({ id }) => (
            <Input id={id} required maxLength={120} value={role} onChange={(e) => setRole(e.target.value)} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('placements.field.ctc')} hint={t('placements.field.ctcHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                inputMode="decimal"
                required
                value={ctc}
                onChange={(e) => setCtc(e.target.value.replace(/[^\d.]/g, ''))}
              />
            )}
          </Field>
          <Field label={t('placements.field.offerDate')}>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                required
                max={today()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('placements.field.roleType')}>
            {({ id }) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as DriveRoleType)}>
                {DRIVE_ROLE_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`placements.roleType.${x}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('placements.field.source')}>
            {({ id }) => (
              <Select id={id} value={source} onChange={(e) => setSource(e.target.value as Source)}>
                {SOURCES.map((x) => (
                  <option key={x} value={x}>
                    {t(`placements.source.${x}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" loading={upload.isPending} onClick={() => fileRef.current?.click()}>
            <FileText className="size-4" aria-hidden />{' '}
            {proof ? t('placements.replaceProof') : t('placements.addProof')}
          </Button>
          <span className="text-meta text-fg-2" aria-live="polite">
            {proof ? proof.name : t('placements.proofHint')}
          </span>
        </div>
        {error && (
          <p role="alert" className="text-meta font-medium text-danger">
            {error}
          </p>
        )}
        <p className="text-caption text-fg-3">{t('placements.proofPrivacy')}</p>
      </form>
    </Dialog>
  );
}
