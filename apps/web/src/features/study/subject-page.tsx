import { lazy, Suspense, useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ListTree, Pencil, Users } from 'lucide-react';
import type { SubjectView, SyllabusUnitView } from '@campuslink/shared';
import { AvatarStack } from '../../components/ui/avatar-stack';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { Dialog, Sheet } from '../../components/ui/dialog';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { findCached, hasId } from '../../lib/query-seed';
import { subject as subjectQuery, syllabus as syllabusQuery } from '../../lib/queries';
import { subjectAccent } from '../../lib/study';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { cn } from '../../lib/cn';
import { AiNotice } from './study';
import { SubjectLibrary } from './library';

// Editors load when opened: the form library, Zod and the editors themselves (bundle budget).
const SubjectForm = lazy(() => import('./subject-form').then((m) => ({ default: m.SubjectForm })));
const SyllabusEditor = lazy(() => import('./syllabus-editor').then((m) => ({ default: m.SyllabusEditor })));
const SubjectPeople = lazy(() => import('./subject-people').then((m) => ({ default: m.SubjectPeople })));

function UnitCard({
  unit,
  index,
  open,
  onToggle,
}: {
  unit: SyllabusUnitView;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const panel = `unit-${unit.id}`;
  return (
    <Card variant="raised" className="overflow-hidden">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={onToggle}
          className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
        >
          <span className="grid size-9 flex-none place-items-center rounded-full bg-brand-surface font-mono text-meta font-bold text-brand-ink">
            {index + 1}
          </span>
          <span className="grid min-w-0 flex-1">
            <span className="eyebrow">{t('study.unit', { n: index + 1 })}</span>
            <span className="truncate font-semibold">{unit.title}</span>
          </span>
          <span className="text-caption text-fg-3">{t('study.topics', { count: unit.topics.length })}</span>
          <ChevronDown
            className={cn(
              'size-5 flex-none text-fg-3 transition-transform duration-[var(--dur-fast)]',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      </h3>
      <div id={panel} hidden={!open} className="border-t border-line px-4 py-3">
        {unit.topics.length ? (
          <ul className="flex flex-wrap gap-2">
            {unit.topics.map((tp) => (
              <li key={tp.id}>
                <span className="inline-flex min-h-9 items-center rounded-full border border-line-strong px-3 text-meta">
                  {tp.title}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-fg-3">{t('study.noTopics')}</p>
        )}
      </div>
    </Card>
  );
}

/**
 * A subject (spec §10): its code in the subject's colour, who teaches it and who takes it, the
 * syllabus tree (Unit → Topic) and the library. Owners and admins edit from sheets that Back closes.
 */
export function SubjectPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sheet = useUrlOverlay('edit');
  const q = useQuery({
    ...subjectQuery(id),
    // The card the member tapped draws the header at once.
    placeholderData: () => findCached(qc, [['subjects']], hasId<SubjectView>('id', id, ['code', 'name'])),
  });
  const tree = useQuery(syllabusQuery(id));
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const back = <BackLink to="/study">{t('study.back')}</BackLink>;

  if (q.isLoading)
    return (
      <div className="grid gap-4">
        {back}
        <Skeleton className="h-48 rounded-[var(--radius-xl)]" />
      </div>
    );
  if (!q.data)
    return (
      <div className="grid gap-4">
        {back}
        <EmptyState art={<Illustration kind="study" />} title={t('study.notFound')}>
          {t('study.notFoundBody')}
        </EmptyState>
      </div>
    );
  const s = q.data;
  const a = subjectAccent(s.code);
  const units = tree.data?.units ?? [];
  const who = [
    s.semester ? t('study.semester', { n: s.semester }) : '',
    s.regulation,
    s.branches.length ? s.branches.join(', ') : t('study.allBranches'),
    s.batches.length ? t('study.batches', { list: s.batches.join(', ') }) : t('study.allBatches'),
  ].filter(Boolean);

  return (
    <div className="grid gap-5">
      {back}
      <Card variant="raised" className="overflow-hidden">
        <div aria-hidden className="h-3" style={{ background: a.solid }} />
        <header className="grid gap-4 p-5 sm:p-6">
          <PageHeader
            as="div"
            eyebrow={
              <span className="inline-flex items-center gap-2">
                <span
                  className="rounded-[var(--radius-xs)] px-1.5 font-mono"
                  style={{ background: a.surface, color: a.ink }}
                >
                  {s.code}
                </span>
                {s.status === 'archived' && <Badge tone="warning">{t('study.archived')}</Badge>}
              </span>
            }
            title={s.name}
            intro={s.description || undefined}
            actions={
              s.can.manage && (
                <>
                  <Button variant="outline" size="sm" onClick={() => sheet.open('subject')}>
                    <Pencil className="size-4" aria-hidden /> {t('study.edit')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => sheet.open('people')}>
                    <Users className="size-4" aria-hidden /> {t('study.peopleTitle')}
                  </Button>
                </>
              )
            }
          />
          <p className="text-meta text-fg-2">{who.join(' · ')}</p>
          {s.owners.length > 0 && (
            <div className="flex items-center gap-2 text-meta text-fg-2">
              <AvatarStack
                people={s.owners.map((o) => ({ name: o.name, fileId: o.avatarFileId }))}
                label={t('study.taughtBy', { names: s.owners.map((o) => o.name).join(', ') })}
              />
              <span className="min-w-0 truncate" aria-hidden>
                {t('study.taughtBy', { names: s.owners.map((o) => o.name).join(', ') })}
              </span>
            </div>
          )}
        </header>
      </Card>

      <AiNotice />

      <section aria-labelledby="syllabus-title" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="syllabus-title" className="flex items-center gap-2 text-title font-semibold">
            <ListTree className="size-5 text-brand-ink" aria-hidden /> {t('study.syllabus')}
          </h2>
          {s.can.manage && units.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => sheet.open('syllabus')}>
              <Pencil className="size-4" aria-hidden /> {t('study.editSyllabus')}
            </Button>
          )}
        </div>
        {tree.isLoading ? (
          <Skeleton className="h-40 rounded-[var(--radius-lg)]" />
        ) : units.length ? (
          <div className="grid gap-2">
            {units.map((u, i) => (
              <UnitCard
                key={u.id}
                unit={u}
                index={i}
                open={!closed.has(u.id)}
                onToggle={() =>
                  setClosed((c) => {
                    const next = new Set(c);
                    if (next.has(u.id)) next.delete(u.id);
                    else next.add(u.id);
                    return next;
                  })
                }
              />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              art={<Illustration kind="empty" size={88} />}
              title={t('study.noSyllabus')}
              action={
                s.can.manage && (
                  <Button variant="primary" onClick={() => sheet.open('syllabus')}>
                    {t('study.addSyllabus')}
                  </Button>
                )
              }
            >
              {s.can.manage ? t('study.noSyllabusManage') : t('study.noSyllabusBody')}
            </EmptyState>
          </Card>
        )}
      </section>

      <SubjectLibrary subject={s} units={units} />

      {s.can.manage && (
        <>
          <Dialog
            open={sheet.value === 'subject'}
            onOpenChange={(o) => !o && sheet.close()}
            title={t('study.edit')}
            history={false}
          >
            <Suspense fallback={<Skeleton className="h-96" />}>
              <SubjectForm subject={s} onDone={() => sheet.close()} />
            </Suspense>
          </Dialog>
          <Sheet
            open={sheet.value === 'syllabus'}
            onOpenChange={(o) => !o && sheet.close()}
            title={t('study.editSyllabus')}
            history={false}
          >
            <Suspense fallback={<Skeleton className="h-96" />}>
              <SyllabusEditor
                subjectId={s.id}
                initial={tree.data ?? { subjectId: s.id, units: [] }}
                onDone={sheet.close}
              />
            </Suspense>
          </Sheet>
          <Sheet
            open={sheet.value === 'people'}
            onOpenChange={(o) => !o && sheet.close()}
            title={t('study.peopleTitle')}
            history={false}
          >
            <Suspense fallback={<Skeleton className="h-96" />}>
              <SubjectPeople subject={s} />
            </Suspense>
          </Sheet>
        </>
      )}
    </div>
  );
}
