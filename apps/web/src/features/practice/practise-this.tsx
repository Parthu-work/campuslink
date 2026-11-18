import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PracticeSetView, PracticeTopic } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { api, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/format';
import * as q from '../../lib/queries';
import { toast } from '../../lib/toast';

/**
 * "Practise this" on a career path's step (prompt 3, U7; moved from U3): a short set from the
 * practice bank for each topic the step names, only where the bank has questions for it. A set is
 * one of the day's extra sets, shared with company sets.
 */
export function PractiseThis({ topics }: { topics: PracticeTopic[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const home = useQuery({ ...q.practice(), staleTime: 5 * 60_000 });
  const start = useMutation({
    mutationFn: (topic: PracticeTopic) =>
      api.postOnce<PracticeSetView>('/practice/sets', { topic }, newIdempotencyKey()),
    onSuccess: (s) => {
      qc.setQueryData(q.practiceSet(s.id).queryKey, s);
      void qc.invalidateQueries({ queryKey: ['practice'], exact: true });
      void navigate(`/practice/sets/${s.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const bank = new Set(home.data?.bankTopics ?? []);
  const available = topics.filter((x) => bank.has(x));
  if (!available.length) return null;
  const left = home.data?.companySetsLeft ?? 0;
  return (
    <ListSection title={t('practice.this.title')} level={3}>
      {available.map((topic) => (
        <ListRow
          key={topic}
          title={t('practice.this.topic', { topic: t(`practice.topic.${topic}`) })}
          meta={left > 0 ? t('practice.this.meta') : t('practice.this.later')}
          chevron={left > 0}
          {...(left > 0 && !start.isPending ? { onClick: () => start.mutate(topic) } : {})}
        />
      ))}
    </ListSection>
  );
}
