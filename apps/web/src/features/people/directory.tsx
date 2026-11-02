import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { BRANCHES, type PublicProfile } from '@campuslink/shared';
import { Input, Select } from '../../components/ui/field';
import { Badge, Card, Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { apiRequest } from '../../lib/api';
import { SCREEN } from '../../lib/query-client';

const ROLE_FILTERS = [
  ['', 'people.all'],
  ['ALUMNI', 'people.alumni'],
  ['STUDENT', 'people.students'],
  ['FACULTY', 'people.faculty'],
  ['TPO', 'people.tpo'],
] as const;

export function PersonCard({ p }: { p: PublicProfile }) {
  const { t } = useTranslation();
  return (
    <Link to={`/people/${p.userId}`} className="block rounded-[var(--radius-md)]">
      <Card variant="interactive" className="flex h-full items-start gap-3 p-4">
        <PersonAvatar name={p.name} fileId={p.avatarFileId} verified={p.verified} />
        <div className="min-w-0 flex-1">
          <b className="block truncate">{p.name}</b>
          {p.fields.headline && <p className="line-clamp-2 text-meta text-fg-2">{p.fields.headline}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            {p.roles.includes('ALUMNI') && <Badge tone="brand">{t('role.ALUMNI')}</Badge>}
            {p.companyVerified && <Badge tone="success">{p.companyVerified.company}</Badge>}
            {!p.companyVerified && p.fields.company && <Badge>{p.fields.company}</Badge>}
            {(p.fields.branch || p.fields.gradYear) && (
              <Badge>
                {[p.fields.branch, p.fields.gradYear ? `’${String(p.fields.gradYear).slice(2)}` : '']
                  .filter(Boolean)
                  .join(' ')}
              </Badge>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

export function DirectoryPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [branch, setBranch] = useState('');
  const dq = useDeferredValue(q.trim());
  const params = new URLSearchParams({
    limit: '20',
    ...(dq ? { q: dq } : {}),
    ...(role ? { role } : {}),
    ...(branch ? { branch } : {}),
  });
  const people = useInfiniteQuery({
    ...SCREEN,
    queryKey: ['directory', dq, role, branch],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiRequest<PublicProfile[]>(`/directory?${params}${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });
  const rows = people.data?.pages.flatMap((p) => p.data) ?? [];

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = people;
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <>
      <PageHeader title={t('people.title')} />
      <div className="grid gap-3">
        <label className="relative">
          <span className="sr-only">{t('people.search')}</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-fg-3"
            aria-hidden
          />
          <Input
            type="search"
            enterKeyHint="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('people.search')}
            className="pl-11"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t('admin.roles')} className="flex flex-wrap gap-2">
            {ROLE_FILTERS.map(([value, key]) => (
              <Chip key={key} pressed={role === value} onClick={() => setRole(value)}>
                {t(key)}
              </Chip>
            ))}
          </div>
          <label className="ml-auto w-full sm:w-44">
            <span className="sr-only">{t('people.branch')}</span>
            <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">{t('people.anyBranch')}</option>
              {BRANCHES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </div>
      {people.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}
      {people.isSuccess && rows.length === 0 && (
        <EmptyState icon={<Users className="size-6" />} title={t('people.empty')}>
          {t('people.emptyBody')}
        </EmptyState>
      )}
      <ul className="grid gap-3 sm:grid-cols-2" aria-live="polite">
        {rows.map((p) => (
          <li key={p.userId}>
            <PersonCard p={p} />
          </li>
        ))}
      </ul>
      <div ref={sentinel} aria-hidden className="h-4" />
      {isFetchingNextPage && <Skeleton className="h-24" />}
    </>
  );
}
