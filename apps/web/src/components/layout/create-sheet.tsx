import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  BriefcaseBusiness,
  CalendarPlus,
  MessageCircleQuestion,
  Orbit,
  PenLine,
  type LucideIcon,
} from 'lucide-react';
import { CREATE_ACTIONS, type CreateActionId } from '@campuslink/shared';
import { useNav } from '../../lib/nav';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { Dialog } from '../ui/dialog';

const ICONS: Record<CreateActionId, LucideIcon> = {
  post: PenLine,
  question: MessageCircleQuestion,
  event: CalendarPlus,
  job: BriefcaseBusiness,
  roadmap: Orbit,
};

/** The centre Create button's sheet: only what this member may create. */
export function CreateSheet() {
  const { t } = useTranslation();
  const nav = useNav();
  const sheet = useUrlOverlay('sheet');
  const actions = CREATE_ACTIONS.filter((a) => nav.create.includes(a.id));
  return (
    <Dialog
      open={sheet.value === 'create'}
      onOpenChange={(o) => !o && sheet.close()}
      title={t('nav.createTitle')}
      history={false}
    >
      <ul className="grid gap-1.5">
        {actions.map((a) => {
          const Icon = ICONS[a.id];
          return (
            <li key={a.id}>
              <Link
                to={a.path}
                replace={sheet.replaceOnLeave}
                className="flex min-h-14 items-center gap-3.5 rounded-[var(--radius-md)] border border-line px-3.5 py-2.5 hover:border-line-strong hover:bg-surface-2"
              >
                <span className="grid size-10 flex-none place-items-center rounded-full bg-surface-2 text-brand-ink">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <b className="block text-[15px]">{t(`nav.createActions.${a.id}`)}</b>
                  <span className="block text-sm text-fg-2">{t(`nav.createActions.${a.id}Hint`)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
