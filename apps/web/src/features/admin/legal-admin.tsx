import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  INACTIVE_MONTHS_MAX,
  INACTIVE_MONTHS_MIN,
  type LegalSettingsBody,
  type LegalSettingsView,
  type RetentionView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Input, Textarea } from '../../components/ui/field';
import { Card, Skeleton } from '../../components/ui/misc';
import { Switch } from '../../components/ui/switch';
import { api, ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import * as q from '../../lib/queries';
import { toast } from '../../lib/toast';

/**
 * Admin › Branding › Legal details (B14): who the college is and its grievance officer, filled into
 * the privacy policy and terms. Publishing makes a new version that members accept on next sign-in.
 */
export function LegalDetails() {
  const current = useQuery(q.adminLegal());
  if (current.isLoading || !current.data) return <Skeleton className="h-64 rounded-[var(--radius-lg)]" />;
  // Keyed by version, so a fresh form starts from what was just published.
  return (
    <>
      <LegalForm key={current.data.version} current={current.data} />
      <RetentionCard />
    </>
  );
}

const initial = (d: LegalSettingsView): LegalSettingsBody => ({
  legalName: d.legalName ?? '',
  address: d.address ?? '',
  grievanceOfficer: {
    name: d.grievanceOfficer?.name ?? '',
    designation: d.grievanceOfficer?.designation ?? '',
    email: d.grievanceOfficer?.email ?? '',
    phone: d.grievanceOfficer?.phone ?? '',
  },
});

function LegalForm({ current }: { current: LegalSettingsView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [v, setV] = useState<LegalSettingsBody>(() => initial(current));
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const officer = (k: keyof LegalSettingsBody['grievanceOfficer']) => (e: { target: { value: string } }) =>
    setV({ ...v, grievanceOfficer: { ...v.grievanceOfficer, [k]: e.target.value } });
  const publish = useMutation({
    mutationFn: () =>
      api.put<LegalSettingsView>('/admin/legal', {
        ...v,
        grievanceOfficer: { ...v.grievanceOfficer, phone: v.grievanceOfficer.phone?.trim() || null },
      }),
    onSuccess: (d) => {
      qc.setQueryData(['admin-legal'], d);
      void qc.invalidateQueries({ queryKey: ['legal'] });
      setConfirm(false);
      toast.success(t('legal.published'));
    },
    onError: (e) => {
      setConfirm(false);
      setError(e instanceof ApiError ? e.message : t('errors.generic'));
    },
  });
  return (
    <Card className="grid gap-4 p-5">
      <div className="grid gap-1">
        <h2 className="text-title font-semibold">{t('legal.detailsTitle')}</h2>
        <p className="text-meta text-fg-2">{t('legal.detailsIntro')}</p>
        {current.version > 0 && (
          <p className="text-caption text-fg-3">
            {t('legal.detailsVersion', {
              version: current.version,
              date: current.updatedAt ? formatDay(current.updatedAt) : '',
            })}
          </p>
        )}
      </div>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          setConfirm(true);
        }}
      >
        <Field label={t('pbilling.legalName')}>
          {({ id }) => (
            <Input
              id={id}
              maxLength={200}
              value={v.legalName}
              onChange={(e) => setV({ ...v, legalName: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('pbilling.address')}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={2}
              maxLength={400}
              value={v.address}
              onChange={(e) => setV({ ...v, address: e.target.value })}
            />
          )}
        </Field>
        <fieldset className="grid gap-4">
          <legend className="mb-1 text-meta font-semibold">{t('legal.officerTitle')}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('legal.officerName')}>
              {({ id }) => (
                <Input id={id} maxLength={100} value={v.grievanceOfficer.name} onChange={officer('name')} />
              )}
            </Field>
            <Field label={t('legal.officerDesignation')}>
              {({ id }) => (
                <Input
                  id={id}
                  maxLength={100}
                  value={v.grievanceOfficer.designation}
                  onChange={officer('designation')}
                />
              )}
            </Field>
            <Field label={t('common.email')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="email"
                  maxLength={254}
                  value={v.grievanceOfficer.email}
                  onChange={officer('email')}
                />
              )}
            </Field>
            <Field label={t('legal.officerPhone')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="tel"
                  maxLength={20}
                  value={v.grievanceOfficer.phone ?? ''}
                  onChange={officer('phone')}
                />
              )}
            </Field>
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-meta text-danger-ink">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" type="submit">
            {t('legal.publish')}
          </Button>
          <Link
            to="/legal/privacy"
            className="inline-flex min-h-11 items-center text-meta font-semibold text-brand-ink underline underline-offset-2"
          >
            {t('legal.preview')}
          </Link>
        </div>
      </form>
      {confirm && (
        <Dialog
          open
          onOpenChange={(o) => !o && setConfirm(false)}
          title={t('legal.publishTitle')}
          description={t('legal.publishBody')}
          footer={
            <div className="grid gap-2 sm:flex sm:flex-row-reverse">
              <Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate()}>
                {t('legal.publish')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          }
        >
          <p className="text-body text-fg-2">{t('legal.publishNote')}</p>
        </Dialog>
      )}
    </Card>
  );
}

/**
 * Prompt 1b, R7: delete accounts nobody has signed in to for some months. Off by default; members are
 * warned 60 and 14 days ahead, staff and members with a placement in progress or an open report are
 * never deleted this way, and the privacy policy states it (members accept the new version).
 */
function RetentionCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const current = useQuery(q.adminRetention());
  const [on, setOn] = useState<boolean | null>(null);
  const [months, setMonths] = useState<string | null>(null);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: (inactiveAccountMonths: number | null) =>
      api.put<RetentionView>('/admin/retention', { inactiveAccountMonths }),
    onSuccess: (data) => {
      qc.setQueryData(q.adminRetention().queryKey, data);
      void qc.invalidateQueries({ queryKey: ['admin-legal'] });
      setOn(null);
      setMonths(null);
      toast.success(t('legal.retentionSaved'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const d = current.data;
  if (!d) return null;
  const enabled = on ?? d.inactiveAccountMonths !== null;
  const value = months ?? String(d.inactiveAccountMonths ?? 36);
  const submit = () => {
    if (!enabled) return save.mutate(null);
    const n = Number(value);
    if (!Number.isInteger(n) || n < INACTIVE_MONTHS_MIN || n > INACTIVE_MONTHS_MAX) {
      setError(t('legal.retentionRange', { min: INACTIVE_MONTHS_MIN, max: INACTIVE_MONTHS_MAX }));
      return;
    }
    setError('');
    save.mutate(n);
  };
  return (
    <Card className="grid gap-4 p-5">
      <div className="grid gap-1">
        <h2 className="text-title font-semibold">{t('legal.retentionTitle')}</h2>
        <p className="text-meta text-fg-2">
          {t('legal.retentionIntro', { days: d.deletedAccountGraceDays })}
        </p>
      </div>
      <Switch checked={enabled} onChange={setOn} label={t('legal.retentionSwitch')} />
      {enabled && (
        <Field
          label={t('legal.retentionMonths')}
          hint={t('legal.retentionRange', { min: INACTIVE_MONTHS_MIN, max: INACTIVE_MONTHS_MAX })}
          error={error || undefined}
        >
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              inputMode="numeric"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              value={value}
              onChange={(e) => setMonths(e.target.value)}
              className="max-w-40"
            />
          )}
        </Field>
      )}
      <p className="text-caption text-fg-3">{t('legal.retentionNote')}</p>
      <Button variant="primary" className="justify-self-start" loading={save.isPending} onClick={submit}>
        {t('common.save')}
      </Button>
    </Card>
  );
}
