import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../../i18n/react';
import { Countdown } from '../../components/ui/countdown';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { drivesForRoles } from '../../lib/placements';
import { placementDrives } from '../../lib/queries';
import { CompanyMark } from '../jobs/job-card';

/**
 * "Drives for this role" (prompt 3, U7; moved from U3): open drives at the college whose roles are
 * what the career path leads to, with their countdowns. Nothing when none match (X7).
 */
export function DrivesOnPath({ roles }: { roles: string[] }) {
  const { t } = useTranslation();
  const q = useQuery({ ...placementDrives('all'), staleTime: 5 * 60_000 });
  const found = drivesForRoles(q.data ?? [], roles);
  if (!found.length) return null;
  return (
    <ListSection title={t('drives.path.title')} level={2}>
      {found.map(({ drive: d, role }) => (
        <ListRow
          key={d.id}
          to={`/placements/${d.id}`}
          leading={<CompanyMark name={d.company.name} />}
          title={d.company.name}
          meta={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{role}</span>
              <Countdown at={d.registrationCloseAt} urgentWithinMs={48 * 3600_000} />
              {(d.eligible || d.overridden) && (
                <span className="font-semibold text-success-ink">{t('placements.youAreEligible')}</span>
              )}
            </span>
          }
        />
      ))}
    </ListSection>
  );
}
