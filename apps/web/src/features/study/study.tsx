import { lazy, Suspense, useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BookOpen, FileText, Layers, ListTree, Plus, Search, Sparkles } from 'lucide-react';
import type { SubjectView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Input } from '../../components/ui/field';
import { Illustration } from '../../components/ui/illustration';
import { IntentLink } from '../../components/ui/intent-link';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { Segmented } from '../../components/ui/tab-nav';
import { useCan, useMe } from '../../lib/me';
import { aiStatus, subjects, type SubjectScope } from '../../lib/queries';
import { subjectAccent } from '../../lib/study';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { SCREEN } from '../../lib/query-client';

// The form library loads with the dialog, not with the library (bundle budget).
const SubjectForm = lazy(() => import('./subject-form').then((m) => ({ default: m.SubjectForm })));

/** A subject as a card: its code in the subject's own colour, the name, and what is in it. */
export function SubjectCard({ s }: { s: SubjectView }) {
  const { t } = useTranslation();
  const a = subjectAccent(s.code);
  return (
    <Card variant="interactive" className="relative flex h-full gap-4 p-4">
      <span
        aria-hidden
        className="grid size-14 flex-none place-items-center rounded-[var(--radius-md)] font-mono text-meta font-bold"
        style={{ background: a.surface, color: a.ink }}
      >
        {s.code.slice(0, 6)}
      </span>
      <div className="grid min-w-0 flex-1 content-start gap-1.5">
        <IntentLink
          to={`/study/${s.id}`}
          className="text-body leading-snug font-semibold after:absolute after:inset-0 hover:underline"
        >
          {s.name}
        </IntentLink>
        <p className="text-meta text-fg-2">
          {[
            s.code,
            s.semester ? t('study.semester', { n: s.semester }) : '',
            s.branches.length ? s.branches.join(', ') : t('study.allBranches'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-caption text-fg-3">
          <span className="inline-flex items-center gap-1">
            <Layers className="size-3.5" aria-hidden /> {t('study.units', { count: s.unitCount })}
          </span>
          <span className="inline-flex items-center gap-1">
            <ListTree className="size-3.5" aria-hidden /> {t('study.topics', { count: s.topicCount })}
          </span>
          <span className="inline-flex items-center gap-1">
            <FileText className="size-3.5" aria-hidden /> {t('study.materials', { count: s.materialCount })}
          </span>
        </p>
        {s.status === 'archived' && (
          <span>
            <Badge tone="warning">{t('study.archived')}</Badge>
          </span>
        )}
      </div>
    </Card>
  );
}

/** Whether AI answers are on; when they are not, says so calmly (search and the library still work). */
export function AiNotice() {
  const { t } = useTranslation();
  const canSetUp = useCan('ai:settings');
  const q = useQuery(aiStatus());
  if (!q.data || (q.data.answers && !q.data.demo)) return null;
  return (
    <Card className="flex items-start gap-3 bg-surface-2 p-4" role="note">
      <Sparkles className="mt-0.5 size-5 flex-none text-brand-ink" aria-hidden />
      <div className="grid min-w-0 flex-1 gap-1 text-meta">
        <p className="font-semibold">
          {q.data.demo
            ? t('study.aiDemo')
            : q.data.reason === 'budget_exhausted'
              ? t('study.aiBudget')
              : t('study.aiOff')}
        </p>
        <p className="text-fg-2">{q.data.demo ? t('study.aiDemoBody') : t('study.aiOffBody')}</p>
        {canSetUp && !q.data.demo && (
          <Link to="/admin/ai" className="w-fit font-semibold text-brand-ink hover:underline">
            {t('study.aiSetUp')}
          </Link>
        )}
      </div>
    </Card>
  );
}

/**
 * The subject library (spec §10): students see the subjects they take; faculty, alumni and admins
 * switch between their own and all. Search narrows by name, code or description.
 */
export function StudyPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const canManage = useCan('study:manage');
  const student = !!me && me.roles.every((r) => r === 'STUDENT');
  const [scope, setScope] = useState<SubjectScope>(student ? 'all' : 'mine');
  const [text, setText] = useState('');
  const q = useDeferredValue(text.trim());
  const form = useUrlOverlay('new');
  const navigate = useNavigate();
  const list = useQuery({
    ...SCREEN,
    ...subjects(student ? 'all' : scope, q.length >= 2 ? q : ''),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="grid gap-5">
      <PageHeader
        size="display"
        icon={<BookOpen />}
        title={t('study.title')}
        intro={student ? t('study.introStudent') : t('study.intro')}
        actions={
          canManage && (
            <Button variant="primary" onClick={() => form.open('subject')}>
              <Plus className="size-5" aria-hidden /> {t('study.newSubject')}
            </Button>
          )
        }
      />
      <AiNotice />
      <div className="flex flex-wrap items-center gap-3">
        {!student && (
          <Segmented<SubjectScope>
            label={t('study.scope')}
            value={scope}
            onChange={setScope}
            options={[
              ['mine', t('study.mine')],
              ['all', t('study.all')],
            ]}
            className="w-full sm:w-auto"
          />
        )}
        <label className="relative min-w-0 flex-1 basis-60">
          <span className="sr-only">{t('study.search')}</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-fg-3"
            aria-hidden
          />
          <Input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('study.searchPlaceholder')}
            className="pl-10"
          />
        </label>
      </div>
      {list.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-[var(--radius-lg)]" />
          ))}
        </div>
      ) : list.data?.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('study.subjects')}>
          {list.data.map((s) => (
            <li key={s.id} className="min-w-0">
              <SubjectCard s={s} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          art={<Illustration kind={q ? 'search' : 'study'} />}
          title={
            q ? t('study.noMatches') : scope === 'mine' && !student ? t('study.noneMine') : t('study.none')
          }
          action={
            canManage &&
            !q && (
              <Button variant="primary" onClick={() => form.open('subject')}>
                <Plus className="size-5" aria-hidden /> {t('study.newSubject')}
              </Button>
            )
          }
        >
          {q ? null : student ? t('study.noneStudentBody') : t('study.noneBody')}
        </EmptyState>
      )}
      {canManage && (
        <Dialog
          open={form.value === 'subject'}
          onOpenChange={(o) => !o && form.close()}
          title={t('study.newSubject')}
          history={false}
        >
          <Suspense fallback={<Skeleton className="h-96" />}>
            <SubjectForm
              // A new subject replaces the dialog's history entry with its page (closing first would
              // go Back and undo the navigation).
              onDone={(created) =>
                created ? void navigate(`/study/${created.id}`, { replace: true }) : form.close()
              }
            />
          </Suspense>
        </Dialog>
      )}
    </div>
  );
}
