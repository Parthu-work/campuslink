import { useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Compass, ExternalLink, Eye, Lock, MapPin } from 'lucide-react';
import type { MentorCard, PublicProfile } from '@campuslink/shared';
import { BackLink } from '../../components/ui/back-link';
import { buttonVariants } from '../../components/ui/button-variants';
import { SafetyMenu } from '../../components/layout/safety-menu';
import { useCan, useMe } from '../../lib/me';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Illustration } from '../../components/ui/illustration';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { RoleChip } from '../../components/ui/role-chip';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { api } from '../../lib/api';
import { coverOf } from '../../lib/accent';
import { cn } from '../../lib/cn';

type Tab = 'about' | 'skills' | 'contact';

/**
 * A member's profile (§8.11): a cover in their own accent, a large face, role chips, headline,
 * branch and batch, whether they mentor, then About / Skills / Contact tabs. It shows only the
 * fields this viewer may see (the API decides); contact details say plainly when they are private.
 */
export function ProfileView() {
  const { userId = '' } = useParams();
  const { t } = useTranslation();
  const { data: me } = useMe();
  const canRequest = useCan('mentorship:request');
  const self = me?.id === userId;
  const tabsId = useId();
  const [tab, setTab] = useState<Tab>('about');
  const q = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => api.get<PublicProfile>(`/profiles/${userId}`),
    enabled: /^[a-f0-9]{24}$/.test(userId),
  });
  // Only mentors who take requests answer here; everyone else is a 404 (no button).
  const mentor = useQuery({
    queryKey: ['mentor', userId],
    queryFn: () => api.get<MentorCard>(`/mentors/${userId}`),
    enabled: canRequest && !self && /^[a-f0-9]{24}$/.test(userId),
    retry: false,
  });
  const back = <BackLink to="/people">{t('people.back')}</BackLink>;
  if (q.isLoading)
    return (
      <div className="mx-auto grid w-full max-w-[760px] gap-4">
        {back}
        <Skeleton className="h-80 rounded-[var(--radius-xl)]" />
      </div>
    );
  if (!q.data)
    return (
      <div className="mx-auto grid w-full max-w-[760px] gap-4">
        {back}
        <EmptyState art={<Illustration kind="people" />} title={t('people.notFound')} />
      </div>
    );
  const p = q.data;
  const f = p.fields;
  const tags = (xs: string[], tone: 'brand' | 'neutral' = 'neutral') => (
    <ul className="flex flex-wrap gap-1.5">
      {xs.map((x) => (
        <li key={x}>
          <Badge tone={tone}>{x}</Badge>
        </li>
      ))}
    </ul>
  );
  const section = (title: string, body: React.ReactNode) => (
    <section className="grid gap-2">
      <h2 className="eyebrow">{title}</h2>
      {body}
    </section>
  );
  const role = [f.jobTitle, p.companyVerified?.company ?? f.company].filter(Boolean);
  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-4">
      {back}
      {self && (
        <p className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-brand-surface px-4 py-3 text-meta">
          <Eye className="size-4 flex-none text-brand-ink" aria-hidden />
          <span className="min-w-0 flex-1">{t('people.selfView')}</span>
          <Link to="/profile" className="font-semibold text-brand-ink hover:underline">
            {t('people.editProfile')}
          </Link>
        </p>
      )}
      <Card variant="raised" className="overflow-hidden">
        <div aria-hidden className="h-24 sm:h-32" style={{ background: coverOf(p.name) }} />
        <div className="grid gap-3 px-5 pb-5 sm:px-6">
          <div className="-mt-12 flex items-end justify-between gap-3 sm:-mt-14">
            <span className="rounded-full ring-4 ring-surface-1">
              <PersonAvatar name={p.name} fileId={p.avatarFileId} size={96} verified={p.verified} />
            </span>
            {!self && <SafetyMenu userId={p.userId} name={p.name} />}
          </div>
          <div className="grid gap-1">
            <h1 className="text-headline leading-tight font-bold">{p.name}</h1>
            {f.headline && <p className="text-lead text-fg-2">{f.headline}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {p.roles.map((r) => (
              <RoleChip key={r} role={r} />
            ))}
            {(f.branch || f.gradYear) && (
              <Badge>
                {[f.branch, f.gradYear ? t('people.batch', { year: f.gradYear }) : '']
                  .filter(Boolean)
                  .join(' · ')}
              </Badge>
            )}
          </div>
          {role.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-1.5 text-body">
              {role.join(' · ')}
              {p.companyVerified && (
                <span
                  className="inline-flex items-center gap-1 text-meta font-semibold text-success"
                  title={t('people.verifiedCompany', { domain: p.companyVerified.domain })}
                >
                  <BadgeCheck className="size-4" aria-hidden /> {t('people.companyVerified')}
                </span>
              )}
            </p>
          )}
          {f.location && (
            <p className="flex items-center gap-1.5 text-meta text-fg-2">
              <MapPin className="size-4" aria-hidden /> {f.location}
            </p>
          )}
          {mentor.data && (
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 text-meta font-semibold',
                  mentor.data.open ? 'text-success' : 'text-warning',
                )}
              >
                <span
                  aria-hidden
                  className={cn('size-2 rounded-full', mentor.data.open ? 'bg-success' : 'bg-warning')}
                />
                {mentor.data.open ? t('people.mentoring') : t('mentors.full')}
              </span>
              <Link
                to={`/mentors/${p.userId}`}
                className={buttonVariants({ variant: 'primary', className: 'ml-auto' })}
              >
                <Compass className="size-4" aria-hidden /> {t('mentors.requestCta')}
              </Link>
            </div>
          )}
        </div>
      </Card>
      <Card variant="raised" className="grid gap-4 px-5 pt-1 pb-5 sm:px-6">
        <Tabs<Tab>
          label={t('people.sections')}
          idBase={tabsId}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'about', label: t('people.about') },
            { id: 'skills', label: t('people.skillsTab') },
            { id: 'contact', label: t('people.contact') },
          ]}
        />
        {tab === 'about' && (
          <TabPanel idBase={tabsId} id="about" className="grid gap-5">
            {f.bio ? (
              <p className="max-w-[65ch] whitespace-pre-line">{f.bio}</p>
            ) : (
              <p className="text-meta text-fg-3">{t('people.noBio')}</p>
            )}
            {f.languages && section(t('people.languages'), tags(f.languages))}
          </TabPanel>
        )}
        {tab === 'skills' && (
          <TabPanel idBase={tabsId} id="skills" className="grid gap-5">
            {f.skills && section(t('people.skills'), tags(f.skills, 'brand'))}
            {f.topics && section(t('people.topics'), tags(f.topics, 'brand'))}
            {!f.skills && !f.topics && <p className="text-meta text-fg-3">{t('people.noSkills')}</p>}
          </TabPanel>
        )}
        {tab === 'contact' && (
          <TabPanel idBase={tabsId} id="contact" className="grid gap-5">
            {f.links &&
              section(
                t('people.links'),
                <ul className="grid gap-1">
                  {f.links.map((l) => (
                    <li key={l.url}>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex min-h-11 items-center gap-1.5 text-brand-ink hover:underline"
                      >
                        {new URL(l.url).hostname.replace(/^www\./, '')}{' '}
                        <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>,
              )}
            {section(
              t('people.contact'),
              f.email || f.phone ? (
                <p className="text-body">{[f.email, f.phone].filter(Boolean).join(' · ')}</p>
              ) : (
                // A clear privacy indicator: hidden by default (data minimisation).
                <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-surface-2 p-3 text-meta text-fg-2">
                  <Lock className="mt-0.5 size-4 flex-none" aria-hidden /> {t('people.contactPrivate')}
                </p>
              ),
            )}
          </TabPanel>
        )}
      </Card>
    </div>
  );
}
