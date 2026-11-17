import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Circle, X } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/misc';
import { useCan, useMe } from '../../lib/me';
import { prefs } from '../../lib/storage';
import { followedRoadmaps, matchPreferences, sentRequests, whatsappStatus } from '../../lib/queries';

interface Item {
  key: string;
  title: string;
  /** What changed, once it is done (X7: each item personalises something the member can see). */
  done: string | null;
  to: string;
}

/**
 * "Set up your CampusLink" (prompt 3, U4): after sign-up and verification, at most four one-tap
 * items for a student, each done from real data (a goal for mentor matching, a followed path, a
 * request sent, WhatsApp updates), and each saying what changed. Hidden once all are done or the
 * member hides it (on this device); an item whose data does not load is left out, never shown undone.
 */
export function SetupChecklist() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const canRequest = useCan('mentorship:request');
  const canFollow = useCan('roadmaps:progress');
  const key = me ? `setup-hidden:${me.id}` : null;
  const [hidden, setHidden] = useState(() => !!key && prefs.get(key) === '1');
  const on = !!me?.verified && canRequest && !hidden;
  const goal = useQuery({ ...matchPreferences(), enabled: on });
  const paths = useQuery({ ...followedRoadmaps(), enabled: on && canFollow });
  const sent = useQuery({ ...sentRequests(), enabled: on });
  const wa = useQuery({ ...whatsappStatus(), enabled: on });
  if (!on || !key) return null;

  const items: Item[] = [];
  if (goal.data) {
    const first = goal.data.goals[0] ?? goal.data.targetCompanies[0];
    items.push({
      key: 'goal',
      title: t('setup.goal'),
      done: first ? t('setup.goalDone', { goal: first }) : null,
      to: '/mentors?goals=1',
    });
  }
  if (canFollow && paths.data) {
    const first = paths.data[0];
    items.push({
      key: 'path',
      title: t('setup.path'),
      done: first ? t('setup.pathDone', { title: first.title }) : null,
      to: first ? `/roadmaps/${first.slug}` : '/roadmaps',
    });
  }
  if (sent.data) {
    const first = sent.data[0];
    items.push({
      key: 'senior',
      title: t('setup.senior'),
      done: first ? t('setup.seniorDone', { name: first.mentor.name }) : null,
      to: first ? '/mentorship?box=sent' : '/mentors',
    });
  }
  // Only where the college sends WhatsApp messages at all.
  if (wa.data?.available)
    items.push({
      key: 'whatsapp',
      title: t('setup.whatsapp'),
      done: wa.data.consented
        ? wa.data.phone
          ? t('setup.whatsappDone', { phone: wa.data.phone })
          : t('setup.whatsappOn')
        : null,
      to: '/settings/notifications',
    });
  const done = items.filter((i) => i.done).length;
  if (!items.length || done === items.length) return null;

  const hide = () => {
    prefs.set(key, '1');
    setHidden(true);
  };
  return (
    <Card className="grid gap-3 p-4" role="region" aria-labelledby="setup-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="setup-title" className="text-headline font-semibold">
            {t('setup.title')}
          </h2>
          <p className="text-callout text-fg-2">{t('setup.progress', { done, total: items.length })}</p>
        </div>
        <Button variant="tertiary" size="sm" className="-mr-2" onClick={hide} aria-label={t('setup.hide')}>
          <X aria-hidden />
        </Button>
      </div>
      <ul className="grid gap-1">
        {items.map((i) => (
          <li key={i.key}>
            <Link
              to={i.to}
              className="pressable flex min-h-12 items-center gap-3 rounded-[var(--radius-md)] px-2 py-2 hover:bg-hover"
            >
              {i.done ? (
                <CheckCircle2 className="size-5 flex-none text-success" aria-hidden />
              ) : (
                <Circle className="size-5 flex-none text-fg-3" aria-hidden />
              )}
              <span className="grid min-w-0 flex-1">
                <span className={i.done ? 'text-body text-fg-2' : 'text-body font-medium'}>
                  {i.title}
                  {i.done && <span className="sr-only"> ({t('setup.doneLabel')})</span>}
                </span>
                {i.done && <span className="text-callout text-fg-2">{i.done}</span>}
              </span>
              <ChevronRight className="size-4 flex-none text-fg-3" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
