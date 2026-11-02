import { GraduationCap } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { PageHeader } from '../../components/ui/page-header';
import { OutcomesPanel } from './outcomes-panel';

/** Your outcomes (B8): offers, higher studies, exams and ventures, for students and alumni alike. */
export function OutcomesPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-5">
      <PageHeader icon={<GraduationCap />} title={t('nav.outcomes')} intro={t('outcomes.intro')} />
      <OutcomesPanel />
      <p className="text-caption text-fg-3">{t('placements.privacyNote')}</p>
    </div>
  );
}
