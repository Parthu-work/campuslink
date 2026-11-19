import { Link, useSearchParams } from 'react-router';
import { useDataSaver } from '../../lib/data-saver';
import { useTranslation } from '../../i18n/react';
import { Lock, Rss } from 'lucide-react';
import { Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { SkeletonRows } from '../../components/ui/skeletons';
import { Segmented } from '../../components/ui/tab-nav';
import { useCan, useMe } from '../../lib/me';
import { formatDay } from '../../lib/format';
import { buttonVariants } from '../../components/ui/button-variants';
import { PageHeader } from '../../components/ui/page-header';
import { Composer } from '../feed/composer';
import { NewStoryButton, StoriesRow } from '../feed/stories';
import { useStoriesShown } from '../feed/use-stories-shown';
import { FeedList } from '../feed/feed-list';
import { firstName } from '../../lib/names';
import { LazyNextSteps } from '../habits/lazy-next-step';
import { LazySetupChecklist, setupWanted } from './lazy-setup';
import { ComingUp, Suggested, TodayCard, WaitingForYou } from './today';
import { useTodayPick } from './today-pick';
import { useMedia } from '../../lib/use-media';

/** Stories show on Home only with this many active ones (prompt 3, U5). */
const STORIES_MIN = 3;

/**
 * Home (prompt 3, U5): the greeting, the single most urgent thing (the Today card), then what else is
 * worth doing (the set-up checklist for new members, an alumnus's waiting requests, this week's next
 * steps, people to follow), then "From your college". Wide screens add a narrow "Coming up" column.
 */
export function HomePage() {
  const { t } = useTranslation();
  const { data: me, isLoading } = useMe();
  const canPost = useCan('feed:post');
  const canNextStep = useCan('nextstep:view');
  const saver = useDataSaver();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'following' ? 'following' : 'for_you';
  const pick = useTodayPick();
  // The xl breakpoint: "Coming up" is a wide screen's column (phones carry the urgent item in Today).
  const wide = useMedia('(min-width: 1280px)');
  // Data saver (B13) leaves stories out: they are mostly photos.
  const storiesShown = useStoriesShown(STORIES_MIN) && !saver;
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
        <PageHeader
          eyebrow={formatDay(new Date())}
          title={
            isLoading || !me ? (
              <Skeleton className="h-9 w-56" />
            ) : (
              t('home.greeting', { name: firstName(me.name) })
            )
          }
        />
        {me && !me.verified && (
          <Card className="flex gap-3 border-warning-border bg-warning-surface p-4" role="status">
            <Lock className="mt-0.5 size-5 flex-none text-warning" aria-hidden />
            <div>
              <h2 className="text-body font-semibold">{t('home.unverifiedTitle')}</h2>
              <p className="text-callout text-fg-2">{t('home.unverifiedBody')}</p>
              <Link
                to="/verify"
                className={buttonVariants({ variant: 'primary', size: 'sm', className: 'mt-3' })}
              >
                {t('home.verifyCta')}
              </Link>
            </div>
          </Card>
        )}
        <TodayCard pick={pick} />
        {/* The first ten minutes (prompt 3, U4): up to four one-tap set-up items. */}
        {me && setupWanted(me) && <LazySetupChecklist fallback={null} />}
        <WaitingForYou />
        {storiesShown && <StoriesRow />}
        {canNextStep && (
          <LazyNextSteps
            skip={
              pick?.kind === 'step'
                ? pick.step.roadmapStep
                  ? 'roadmap'
                  : pick.step.opportunity
                    ? 'opportunity'
                    : 'alumnus'
                : null
            }
            fallback={<SkeletonRows title rows={2} leading="icon" />}
          />
        )}
        <Suggested />
        <section aria-labelledby="from-college" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="from-college" className="text-title font-semibold">
              {t('today.fromCollege')}
            </h2>
            {!storiesShown && !saver && <NewStoryButton />}
          </div>
          {canPost && <Composer />}
          <Segmented
            label={t('feed.tabs')}
            value={tab}
            options={[
              ['for_you', t('feed.forYou')],
              ['following', t('feed.followingTab')],
            ]}
            onChange={(v) => setParams(v === 'following' ? { tab: v } : {}, { replace: true })}
          />
          <FeedList
            key={tab}
            queryKey={['feed', tab]}
            path={`/feed?tab=${tab}&limit=15`}
            label={tab === 'following' ? t('feed.followingTab') : t('feed.forYou')}
            empty={
              <EmptyState
                icon={<Rss className="size-6" />}
                title={tab === 'following' ? t('feed.emptyFollowing') : t('feed.emptyForYou')}
                action={
                  <Link to="/following" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
                    {t('feed.findThingsToFollow')}
                  </Link>
                }
              >
                {tab === 'following' ? t('feed.emptyFollowingBody') : t('feed.emptyForYouBody')}
              </EmptyState>
            }
          />
        </section>
      </div>
      {wide && (
        <div className="sticky top-5 self-start">
          <ComingUp />
        </div>
      )}
    </div>
  );
}
