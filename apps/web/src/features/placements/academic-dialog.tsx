import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AcademicRecordView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Input } from '../../components/ui/field';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';

type Key = 'cgpa' | 'activeBacklogs' | 'historyBacklogs' | 'tenthPct' | 'twelfthPct' | 'diplomaPct';
const FIELDS: readonly { key: Key; required: boolean; decimal: boolean }[] = [
  { key: 'cgpa', required: true, decimal: true },
  { key: 'activeBacklogs', required: true, decimal: false },
  { key: 'historyBacklogs', required: true, decimal: false },
  { key: 'tenthPct', required: false, decimal: true },
  { key: 'twelfthPct', required: false, decimal: true },
  { key: 'diplomaPct', required: false, decimal: true },
];
const num = (v: string) => (v.trim() === '' ? null : Number(v));

/**
 * A student's own academic figures, for colleges that have not imported them: they count for
 * eligibility only once the placement cell verifies them.
 */
export function AcademicDialog({
  record,
  onClose,
}: {
  record: AcademicRecordView | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<Key, string>>(
    () =>
      Object.fromEntries(
        FIELDS.map(({ key }) => [key, record?.[key] === null || !record ? '' : String(record[key])]),
      ) as Record<Key, string>,
  );
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.put<AcademicRecordView>('/me/academics', {
        cgpa: num(values.cgpa),
        activeBacklogs: num(values.activeBacklogs),
        historyBacklogs: num(values.historyBacklogs),
        tenthPct: num(values.tenthPct),
        twelfthPct: num(values.twelfthPct),
        diplomaPct: num(values.diplomaPct),
      }),
    onSuccess: () => {
      toast.success(t('placements.recordSent'));
      void qc.invalidateQueries({ queryKey: ['my-academics'] });
      void qc.invalidateQueries({ queryKey: ['placement-drives'] });
      void qc.invalidateQueries({ queryKey: ['placement-drive'] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const ready = FIELDS.every((f) => !f.required || values[f.key].trim() !== '');
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('placements.recordTitle')}
      description={t('placements.recordBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            type="submit"
            form="academic-record"
            loading={save.isPending}
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
        id="academic-record"
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) save.mutate();
        }}
      >
        {FIELDS.map((f) => (
          <Field
            key={f.key}
            label={t(`placements.field.${f.key}`)}
            aside={f.required ? undefined : t('common.optional')}
          >
            {({ id }) => (
              <Input
                id={id}
                inputMode={f.decimal ? 'decimal' : 'numeric'}
                required={f.required}
                value={values[f.key]}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    [f.key]: e.target.value.replace(f.decimal ? /[^\d.]/g : /\D/g, ''),
                  }))
                }
              />
            )}
          </Field>
        ))}
        {error && (
          <p role="alert" className="text-meta font-medium text-danger sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
