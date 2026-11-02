import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EXAM_LEVELS, EXAMS, type Exam, type ExamLevel, type OutcomeKind } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Input, Select } from '../../components/ui/field';
import { Switch } from '../../components/ui/switch';
import { api, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/format';
import { toast } from '../../lib/toast';

const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: 8 }, (_, i) => thisYear + 1 - i);

/** Report admission to higher studies, a qualified exam or a venture (verified by the placement cell). */
export function OutcomeDialog({ kind, onClose }: { kind: OutcomeKind; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [key] = useState(newIdempotencyKey);
  const [institution, setInstitution] = useState('');
  const [program, setProgram] = useState('');
  const [country, setCountry] = useState('India');
  const [qualifyingExam, setQualifyingExam] = useState<Exam | ''>('');
  const [exam, setExam] = useState<Exam>('GATE');
  const [examName, setExamName] = useState('');
  const [level, setLevel] = useState<ExamLevel>('national');
  const [scoreBand, setScoreBand] = useState('');
  const [name, setName] = useState('');
  const [registered, setRegistered] = useState(false);
  const [year, setYear] = useState(thisYear);
  const [error, setError] = useState('');
  const body =
    kind === 'higher_study'
      ? {
          institution: institution.trim(),
          program: program.trim(),
          country: country.trim() || 'India',
          admitYear: year,
          qualifyingExam: qualifyingExam || null,
        }
      : kind === 'exam'
        ? {
            exam,
            year,
            scoreBand: scoreBand.trim(),
            ...(exam === 'OTHER' ? { examName: examName.trim(), level } : {}),
          }
        : { name: name.trim(), registered, year };
  const ready =
    kind === 'higher_study'
      ? institution.trim().length >= 2 && program.trim().length >= 2
      : kind === 'exam'
        ? exam !== 'OTHER' || examName.trim().length >= 2
        : name.trim().length >= 2;
  const send = useMutation({
    mutationFn: () => api.postOnce(`/me/outcomes/${kind}`, body, key),
    onSuccess: () => {
      toast.success(t('outcomes.sent'));
      void qc.invalidateQueries({ queryKey: ['my-outcomes'] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const yearField = (label: string) => (
    <Field label={label}>
      {({ id }) => (
        <Select id={id} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(`outcomes.add.${kind}`)}
      description={t('outcomes.dialogBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            type="submit"
            form="outcome-form"
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
        id="outcome-form"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) send.mutate();
        }}
      >
        {kind === 'higher_study' && (
          <>
            <Field label={t('outcomes.field.institution')}>
              {({ id }) => (
                <Input
                  id={id}
                  maxLength={160}
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('outcomes.field.program')} hint={t('outcomes.field.programHint')}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  maxLength={120}
                  value={program}
                  onChange={(e) => setProgram(e.target.value)}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('outcomes.field.country')}>
                {({ id }) => (
                  <Input
                    id={id}
                    maxLength={60}
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  />
                )}
              </Field>
              {yearField(t('outcomes.field.admitYear'))}
            </div>
            <Field label={t('outcomes.field.qualifyingExam')} aside={t('common.optional')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={qualifyingExam}
                  onChange={(e) => setQualifyingExam(e.target.value as Exam | '')}
                >
                  <option value="">{t('outcomes.noExam')}</option>
                  {EXAMS.filter((x) => x !== 'OTHER').map((x) => (
                    <option key={x} value={x}>
                      {t(`outcomes.exam.${x}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}
        {kind === 'exam' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('outcomes.field.exam')}>
                {({ id }) => (
                  <Select id={id} value={exam} onChange={(e) => setExam(e.target.value as Exam)}>
                    {EXAMS.map((x) => (
                      <option key={x} value={x}>
                        {t(`outcomes.exam.${x}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {yearField(t('outcomes.field.examYear'))}
            </div>
            {exam === 'OTHER' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('outcomes.field.examName')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      maxLength={80}
                      value={examName}
                      onChange={(e) => setExamName(e.target.value)}
                    />
                  )}
                </Field>
                <Field label={t('outcomes.field.level')}>
                  {({ id }) => (
                    <Select id={id} value={level} onChange={(e) => setLevel(e.target.value as ExamLevel)}>
                      {EXAM_LEVELS.map((x) => (
                        <option key={x} value={x}>
                          {t(`outcomes.level.${x}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            )}
            <Field
              label={t('outcomes.field.scoreBand')}
              hint={t('outcomes.field.scoreBandHint')}
              aside={t('common.optional')}
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  maxLength={60}
                  value={scoreBand}
                  onChange={(e) => setScoreBand(e.target.value)}
                />
              )}
            </Field>
          </>
        )}
        {kind === 'venture' && (
          <>
            <Field label={t('outcomes.field.ventureName')}>
              {({ id }) => (
                <Input id={id} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            {yearField(t('outcomes.field.ventureYear'))}
            <Switch
              checked={registered}
              onChange={setRegistered}
              label={t('outcomes.field.registered')}
              description={t('outcomes.field.registeredHint')}
            />
          </>
        )}
        {error && (
          <p role="alert" className="text-meta font-medium text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
