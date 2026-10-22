import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Compass, ExternalLink, Lock, UserX } from 'lucide-react';
import type { MentorCard, PublicProfile } from '@campuslink/shared';
import { BackLink } from '../../components/ui/back-link';
import { buttonVariants } from '../../components/ui/button-variants';
import { SafetyMenu } from '../../components/layout/safety-menu';
import { useCan, useMe } from '../../lib/me';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { api } from '../../lib/api';

export function ProfileView() {
  const { userId = '' } = useParams();
  const { t } = useTranslation();
  const { data: me } = useMe();
  const canRequest = useCan('mentorship:request');
  const self = me?.id === userId;
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
  if (q.isLoading) return <Skeleton className="h-72" />;
  if (!q.data)
    return (
      <>
        {back}
        <EmptyState icon={<UserX className="size-6" />} title={t('people.notFound')} />
      </>
    );
  const p = q.data;
  const f = p.fields;
  const section = (title: string, body: React.ReactNode) => (
    <section className="grid gap-2">
      <h2 className="eyebrow">{title}</h2>
      {body}
    </section>
  );
  const tags = (xs: string[]) => (
    <div className="flex flex-wrap gap-1.5">
      {xs.map((x) => (
        <Badge key={x} className="text-xs">
          {x}
        </Badge>
      ))}
    </div>
  );
  return (
    <>
      {back}
      <Card className="relative overflow-hidden p-5 pt-16">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(60%_120%_at_20%_0%,color-mix(in_srgb,var(--brand)_55%,transparent),transparent_70%),radial-gradient(60%_140%_at_90%_10%,color-mix(in_srgb,var(--brand-2)_60%,transparent),transparent_70%)]"
        />
        <div className="relative grid gap-3">
          <div className="flex items-end justify-between gap-3">
            <PersonAvatar name={p.name} fileId={p.avatarFileId} size={88} verified={p.verified} />
            {!self && <SafetyMenu userId={p.userId} name={p.name} />}
          </div>
          <div>
            <h1 className="text-[28px] leading-tight font-bold">{p.name}</h1>
            {f.headline && <p className="text-fg-2">{f.headline}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {p.roles.map((r) => (
              <Badge key={r} tone="brand">
                {t(`role.${r}`)}
              </Badge>
            ))}
            {(f.branch || f.gradYear) && (
              <Badge>
                {[f.branch, f.gradYear ? t('people.batch', { year: f.gradYear }) : '']
                  .filter(Boolean)
                  .join(' · ')}
              </Badge>
            )}
            {p.companyVerified && (
              <Badge tone="success" title={t('people.verifiedCompany', { domain: p.companyVerified.domain })}>
                <BadgeCheck className="size-3.5" aria-hidden /> {p.companyVerified.company}
              </Badge>
            )}
          </div>
          {(f.jobTitle || f.company) && !p.companyVerified && (
            <p className="text-sm">{[f.jobTitle, f.company].filter(Boolean).join(' · ')}</p>
          )}
          {p.companyVerified && f.jobTitle && <p className="text-sm">{f.jobTitle}</p>}
          {mentor.data && (
            <Link
              to={`/mentors/${p.userId}`}
              className={buttonVariants({ variant: 'primary', className: 'justify-self-start' })}
            >
              <Compass className="size-4" aria-hidden /> {t('mentors.requestCta')}
            </Link>
          )}
        </div>
      </Card>
      <Card className="grid gap-5 p-5">
        {f.bio && section(t('people.about'), <p className="whitespace-pre-line">{f.bio}</p>)}
        {f.skills && section(t('people.skills'), tags(f.skills))}
        {f.topics && section(t('people.topics'), tags(f.topics))}
        {f.languages && section(t('people.languages'), tags(f.languages))}
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
                    className="inline-flex items-center gap-1.5 text-brand-ink hover:underline"
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
            <p className="font-mono text-sm">{[f.email, f.phone].filter(Boolean).join(' · ')}</p>
          ) : (
            <p className="flex items-start gap-2 text-sm text-fg-2">
              <Lock className="mt-0.5 size-4 flex-none" aria-hidden /> {t('people.contactPrivate')}
            </p>
          ),
        )}
      </Card>
    </>
  );
}
