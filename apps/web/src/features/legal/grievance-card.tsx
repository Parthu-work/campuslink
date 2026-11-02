import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { Card } from '../../components/ui/misc';
import * as q from '../../lib/queries';

/** Settings › Privacy (B14): the college's grievance officer and its legal pages. */
export function GrievanceCard() {
  const { t, i18n } = useTranslation();
  const doc = useQuery(q.legalDoc('privacy', i18n.language));
  const officer = doc.data?.grievanceOfficer;
  return (
    <Card className="grid gap-3 p-5">
      <h2 className="text-title font-semibold">{t('legal.officerTitle')}</h2>
      {officer ? (
        <dl className="grid gap-1 text-body">
          <dt className="sr-only">{t('legal.officerName')}</dt>
          <dd className="font-semibold">
            {officer.name} · <span className="font-normal text-fg-2">{officer.designation}</span>
          </dd>
          <dt className="sr-only">{t('common.email')}</dt>
          <dd>
            <a href={`mailto:${officer.email}`} className="text-brand-ink underline underline-offset-2">
              {officer.email}
            </a>
          </dd>
          {officer.phone && (
            <>
              <dt className="sr-only">{t('legal.officerPhone')}</dt>
              <dd>{officer.phone}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-meta text-fg-2">{t('legal.officerMissing')}</p>
      )}
      <p className="text-meta text-fg-2">{t('legal.officerBody')}</p>
      <div className="flex flex-wrap gap-4 text-meta">
        <Link to="/legal/privacy" className="font-semibold text-brand-ink underline underline-offset-2">
          {t('legal.privacy')}
        </Link>
        <Link to="/legal/terms" className="font-semibold text-brand-ink underline underline-offset-2">
          {t('legal.terms')}
        </Link>
      </div>
    </Card>
  );
}
