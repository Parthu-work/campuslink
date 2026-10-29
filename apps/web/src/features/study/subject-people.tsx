import { useDeferredValue, useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, UserMinus, UserPlus, X } from 'lucide-react';
import type { EnrollmentView, PersonRef, PublicProfile, SubjectView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/field';
import { Badge } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { api, ApiError } from '../../lib/api';
import { useCan } from '../../lib/me';
import { toast } from '../../lib/toast';

type PickRole = 'FACULTY' | 'STUDENT' | 'ALUMNI';

/** Finds a verified member of one role in the directory and offers an action on each. */
function PersonPicker({
  label,
  role,
  exclude,
  actions,
}: {
  label: string;
  role: PickRole;
  exclude: string[];
  actions: (p: PublicProfile) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const q = useDeferredValue(text.trim());
  const found = useQuery({
    queryKey: ['directory', role, q],
    queryFn: () => api.get<PublicProfile[]>(`/directory?role=${role}&limit=8&q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
  const rows = (found.data ?? []).filter((p) => !exclude.includes(p.userId));
  return (
    <div className="grid gap-2">
      <Input
        type="search"
        aria-label={label}
        placeholder={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {q.length >= 2 && (
        <ul className="grid gap-1" aria-live="polite">
          {rows.map((p) => (
            <li
              key={p.userId}
              className="flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-1.5 hover:bg-hover"
            >
              <PersonAvatar name={p.name} fileId={p.avatarFileId} size={32} />
              <span className="min-w-0 flex-1 truncate text-meta font-semibold">{p.name}</span>
              {actions(p)}
            </li>
          ))}
          {!found.isLoading && rows.length === 0 && (
            <li className="px-2 text-meta text-fg-3">{t('study.people.noOne')}</li>
          )}
        </ul>
      )}
    </div>
  );
}

function PersonRow({ p, children }: { p: PersonRef; children?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-[var(--radius-md)] bg-surface-2 px-3 py-2">
      <PersonAvatar name={p.name} fileId={p.avatarFileId} size={32} />
      <span className="min-w-0 flex-1 truncate text-meta font-semibold">{p.name}</span>
      {children}
    </li>
  );
}

/**
 * Who teaches a subject (owners), the students added or left out by hand (the branch and batch
 * rule covers everyone else), and, for admins, alumni granted to contribute material.
 */
export function SubjectPeople({ subject }: { subject: SubjectView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canGrant = useCan('capabilities:grant');
  const base = `/study/subjects/${subject.id}`;
  const overrides = useQuery({
    queryKey: ['subject-enrollments', subject.id],
    queryFn: () => api.get<EnrollmentView[]>(`${base}/enrollments`),
  });
  const contributors = useQuery({
    queryKey: ['subject-contributors', subject.id],
    queryFn: () => api.get<PersonRef[]>(`${base}/contributors`),
  });
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const refresh = (s: SubjectView) => {
    qc.setQueryData(['subject', s.id], s);
    void qc.invalidateQueries({ queryKey: ['subjects'] });
  };
  const owners = useMutation({
    mutationFn: (ids: string[]) => api.patch<SubjectView>(base, { ownerIds: ids }),
    onSuccess: refresh,
    onError: fail,
  });
  const enroll = useMutation({
    mutationFn: (v: { userId: string; kind: 'include' | 'exclude' | null }) =>
      v.kind
        ? api.put<EnrollmentView[]>(`${base}/enrollments`, v)
        : api.delete<EnrollmentView[]>(`${base}/enrollments/${v.userId}`),
    onSuccess: (rows) => qc.setQueryData(['subject-enrollments', subject.id], rows),
    onError: fail,
  });
  const grant = useMutation({
    mutationFn: (v: { userId: string; grant: boolean }) => api.put<SubjectView>(`${base}/contributors`, v),
    onSuccess: (s) => {
      refresh(s);
      void contributors.refetch();
    },
    onError: fail,
  });
  const ownerIds = subject.owners.map((o) => o.userId);
  const listed = (overrides.data ?? []).map((o) => o.user.userId);

  return (
    <div className="grid gap-6">
      <section className="grid gap-2" aria-labelledby="owners-h">
        <h3 id="owners-h" className="font-semibold">
          {t('study.people.owners')}
        </h3>
        <p className="text-meta text-fg-2">{t('study.people.ownersBody')}</p>
        <ul className="grid gap-1.5">
          {subject.owners.map((o) => (
            <PersonRow key={o.userId} p={o}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('study.people.removeOwner', { name: o.name })}
                onClick={() => owners.mutate(ownerIds.filter((x) => x !== o.userId))}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </PersonRow>
          ))}
        </ul>
        <PersonPicker
          label={t('study.people.findFaculty')}
          role="FACULTY"
          exclude={ownerIds}
          actions={(p) => (
            <Button variant="outline" size="sm" onClick={() => owners.mutate([...ownerIds, p.userId])}>
              <Plus className="size-4" aria-hidden /> {t('study.people.addOwner')}
            </Button>
          )}
        />
      </section>

      <section className="grid gap-2" aria-labelledby="takes-h">
        <h3 id="takes-h" className="font-semibold">
          {t('study.people.whoTakes')}
        </h3>
        <p className="text-meta text-fg-2">
          {t('study.people.rule', {
            branches: subject.branches.length ? subject.branches.join(', ') : t('study.allBranches'),
            batches: subject.batches.length ? subject.batches.join(', ') : t('study.allBatches'),
          })}
        </p>
        <ul className="grid gap-1.5">
          {(overrides.data ?? []).map((o) => (
            <PersonRow key={o.user.userId} p={o.user}>
              <Badge tone={o.kind === 'include' ? 'success' : 'warning'}>
                {o.kind === 'include' ? t('study.people.included') : t('study.people.excluded')}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('study.people.removeOverride', { name: o.user.name })}
                onClick={() => enroll.mutate({ userId: o.user.userId, kind: null })}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </PersonRow>
          ))}
        </ul>
        <PersonPicker
          label={t('study.people.findStudent')}
          role="STUDENT"
          exclude={listed}
          actions={(p) => (
            <span className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => enroll.mutate({ userId: p.userId, kind: 'include' })}
              >
                <UserPlus className="size-4" aria-hidden /> {t('study.people.include')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => enroll.mutate({ userId: p.userId, kind: 'exclude' })}
              >
                <UserMinus className="size-4" aria-hidden /> {t('study.people.exclude')}
              </Button>
            </span>
          )}
        />
      </section>

      <section className="grid gap-2" aria-labelledby="contrib-h">
        <h3 id="contrib-h" className="font-semibold">
          {t('study.people.contributors')}
        </h3>
        <p className="text-meta text-fg-2">{t('study.people.contributorsBody')}</p>
        <ul className="grid gap-1.5">
          {(contributors.data ?? []).map((c) => (
            <PersonRow key={c.userId} p={c}>
              {canGrant && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('study.people.revoke', { name: c.name })}
                  onClick={() => grant.mutate({ userId: c.userId, grant: false })}
                >
                  <Minus className="size-4" aria-hidden />
                </Button>
              )}
            </PersonRow>
          ))}
          {contributors.data?.length === 0 && (
            <li className="text-meta text-fg-3">{t('study.people.noContributors')}</li>
          )}
        </ul>
        {canGrant && (
          <PersonPicker
            label={t('study.people.findAlumni')}
            role="ALUMNI"
            exclude={(contributors.data ?? []).map((c) => c.userId)}
            actions={(p) => (
              <Button
                variant="outline"
                size="sm"
                onClick={() => grant.mutate({ userId: p.userId, grant: true })}
              >
                <Plus className="size-4" aria-hidden /> {t('study.people.grant')}
              </Button>
            )}
          />
        )}
      </section>
    </div>
  );
}
