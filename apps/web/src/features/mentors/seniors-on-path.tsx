import { useQuery } from '@tanstack/react-query';
import type { MentorCard } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { Badge } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { buttonVariants } from '../../components/ui/button-variants';
import { IntentLink } from '../../components/ui/intent-link';
import { api } from '../../lib/api';
import { isDemoMentor, stripDemo } from './mentor-text';

const norm = (s: string) => stripDemo(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** Up to three seniors from the mentor list's own search whose `field` matches `term` either way round. */
function useSeniors(term: string, field: 'jobTitle' | 'company', key: string) {
  const want = norm(term);
  const q = useQuery({
    queryKey: ['mentors', key, want],
    queryFn: () => api.get<MentorCard[]>(`/mentors?${new URLSearchParams({ q: term, limit: '10' })}`),
    staleTime: 5 * 60_000,
    enabled: want.length > 1,
  });
  return (q.data ?? [])
    .filter((m) => {
      const have = norm(m[field]);
      return !!have && (have.includes(want) || want.includes(have));
    })
    .slice(0, 3);
}

/**
 * "Seniors on this path" (prompt 3, U6; moved from U3): up to three seniors whose job title is the
 * role the path leads to, from the mentor list's own search, then checked against the job title
 * here so the reason shown is true. Nothing when nobody matches.
 */
export function SeniorsOnPath({ role }: { role: string }) {
  const { t } = useTranslation();
  const seniors = useSeniors(role, 'jobTitle', 'on-path');
  return <SeniorRows title={t('mentoring.seniors.title')} seniors={seniors} />;
}

/**
 * "Seniors there who mentor" on a company page (prompt 3, U7): up to three mentors whose company
 * is this one, checked here against the company name. Nothing when nobody matches.
 */
export function SeniorsAt({ company }: { company: string }) {
  const { t } = useTranslation();
  const seniors = useSeniors(company, 'company', 'at-company');
  return <SeniorRows title={t('mentoring.seniors.atTitle')} seniors={seniors} />;
}

function SeniorRows({ title, seniors }: { title: string; seniors: MentorCard[] }) {
  const { t } = useTranslation();
  if (!seniors.length) return null;
  return (
    <ListSection title={title} level={2}>
      {seniors.map((m) => {
        const name = stripDemo(m.name);
        const company = stripDemo(m.company);
        return (
          <ListRow
            key={m.userId}
            leading={<PersonAvatar name={m.name} fileId={m.avatarFileId} size={40} />}
            title={
              <span className="flex flex-wrap items-center gap-1.5">
                {name}
                {isDemoMentor(m) && <Badge>{t('common.demo')}</Badge>}
              </span>
            }
            meta={
              company
                ? t('mentoring.seniors.worksAt', { title: stripDemo(m.jobTitle), company })
                : t('mentoring.seniors.worksAs', { title: stripDemo(m.jobTitle) })
            }
            trailing={
              <IntentLink
                to={`/mentors/${m.userId}?ask=request`}
                aria-label={t('mentoring.seniors.askName', { name })}
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                {t('mentoring.seniors.ask')}
              </IntentLink>
            }
          />
        );
      })}
    </ListSection>
  );
}
