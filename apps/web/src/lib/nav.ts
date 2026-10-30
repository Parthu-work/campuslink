import { useMemo } from 'react';
import { useTranslation } from '../i18n/react';
import {
  Activity,
  BadgeCheck,
  Bell,
  BookOpen,
  Bookmark,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  Compass,
  Film,
  Gift,
  HandHelping,
  HeartHandshake,
  Home,
  Inbox,
  Library,
  Medal,
  MessageCircleQuestion,
  MessagesSquare,
  Orbit,
  Plus,
  Rss,
  Settings,
  Shield,
  Sparkles,
  Trophy,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  buildNav,
  featureShipped,
  type AdminGroup,
  type AdminSectionId,
  type SettingsSectionId,
  type CreateActionId,
  type NavDestination,
  type NavGroup,
  type NavId,
  type Role,
} from '@campuslink/shared';
import { useMe } from './me';
import { useTenant } from './tenant-context';
import { useUnreadMessages, useUnreadNotifications } from './unread';

export const NAV_ICONS: Record<NavId, LucideIcon> = {
  home: Home,
  study: BookOpen,
  assistant: Sparkles,
  subjects: Library,
  create: Plus,
  mentors: Compass,
  jobs: BriefcaseBusiness,
  placements: Building2,
  requests: Inbox,
  review: ClipboardCheck,
  roadmaps: Orbit,
  events: CalendarDays,
  questions: MessageCircleQuestion,
  progress: Trophy,
  sessions: CalendarClock,
  messages: MessagesSquare,
  notifications: Bell,
  people: Users,
  referrals: HandHelping,
  mentoring: HeartHandshake,
  reels: Film,
  following: Rss,
  saved: Bookmark,
  leaderboard: Medal,
  rewards: Gift,
  profile: User,
  settings: Settings,
  admin: Shield,
  verify: BadgeCheck,
  platform: Building2,
  health: Activity,
};

/** i18n keys under `nav.` (a few ids reuse older keys). */
const LABEL_KEY: Partial<Record<NavId, string>> = { mentoring: 'mentor' };

/** Screens that exist in this build. Review joins when it ships. */
const COLLEGE_SHIPPED: ReadonlySet<NavId> = new Set<NavId>([
  'home',
  'study',
  'assistant',
  'subjects',
  'mentors',
  'jobs',
  'placements',
  'requests',
  'roadmaps',
  'events',
  'questions',
  'progress',
  'sessions',
  'messages',
  'notifications',
  'people',
  'referrals',
  'mentoring',
  'reels',
  'following',
  'saved',
  'leaderboard',
  'rewards',
  'profile',
  'settings',
  'admin',
  'verify',
]);
const PLATFORM_SHIPPED: ReadonlySet<NavId> = new Set<NavId>(['platform', 'health', 'settings']);

export interface NavEntry {
  id: NavId;
  to: string;
  label: string;
  icon: LucideIcon;
  badge: number;
}

/** i18n keys under `admin.` for the admin sections (one reuses an older key). */
const ADMIN_LABEL: Partial<Record<AdminSectionId, string>> = { mentorship: 'mentorshipTab' };

/** i18n keys for the settings sections. */
const SETTINGS_LABEL: Record<SettingsSectionId, string> = {
  security: 'settings.security',
  privacy: 'settings.privacy',
  preferences: 'settings.preferences',
  notifications: 'settings.notifications',
  data: 'settings.data.tab',
};

export interface AdminNavGroup {
  group: AdminGroup;
  label: string;
  items: { id: AdminSectionId; to: string; label: string }[];
}

/** Role-aware navigation for every surface: tabs, rail, avatar menu and the Create sheet. */
export function useNav() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const tenant = useTenant();
  const platform = tenant.kind === 'platform';
  const unreadMessages = useUnreadMessages(!platform);
  const unreadNotifications = useUnreadNotifications(!platform);

  return useMemo(() => {
    const permissions = me?.permissions ?? [];
    const model = buildNav(
      {
        roles: (me?.roles ?? []) as Role[],
        permissions: permissions as never[],
        verified: platform || !!me?.verified,
        features: tenant.features,
        gradYear: me?.gradYear ?? null,
      },
      platform ? PLATFORM_SHIPPED : featureShipped(COLLEGE_SHIPPED, tenant.features),
    );
    const badges: Partial<Record<NavId, number>> = {
      messages: unreadMessages,
      notifications: unreadNotifications,
    };
    const entry = (d: NavDestination): NavEntry => ({
      id: d.id,
      to: d.path,
      label: t(`nav.${LABEL_KEY[d.id] ?? d.id}`),
      icon: NAV_ICONS[d.id],
      badge: badges[d.id] ?? 0,
    });
    return {
      persona: model.persona,
      tabs: model.tabs.map(entry),
      menu: model.menu.map((g) => ({
        group: g.group as NavGroup,
        label: t(`nav.groups.${g.group}`),
        items: g.items.map(entry),
      })),
      create: model.create as CreateActionId[],
      /** The admin area's sections, grouped (its side menu and overview add the icons). */
      admin: model.admin.map((g): AdminNavGroup => ({
        group: g.group,
        label: t(`admin.groups.${g.group}`),
        items: g.items.map((x) => ({ id: x.id, to: x.path, label: t(`admin.${ADMIN_LABEL[x.id] ?? x.id}`) })),
      })),
      /** The settings tab row: [path, label]. */
      settings: model.settings.map((x) => [x.path, t(SETTINGS_LABEL[x.id])] as const),
      unreadMessages,
      unreadNotifications,
      canMessage: permissions.includes('messages:send'),
    };
  }, [me, platform, tenant.features, t, unreadMessages, unreadNotifications]);
}

/** Platform-aware shortcut hint for the command palette (⌘K on Apple devices). */
export function paletteShortcut(): string {
  const p = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/i.test(p) ? '⌘K' : 'Ctrl K';
}
