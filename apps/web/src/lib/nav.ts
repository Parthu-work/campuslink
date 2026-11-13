import { useMemo } from 'react';
import { useTranslation } from '../i18n/react';
import {
  Activity,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  ClipboardCheck,
  Compass,
  GraduationCap,
  HeartHandshake,
  Home,
  Library,
  ReceiptIndianRupee,
  Settings,
  TrendingUp,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  buildNav,
  featureShipped,
  landingPath,
  type AdminGroup,
  type AdminSectionId,
  type SettingsSectionId,
  type CreateActionId,
  type NavId,
  type NavSection,
  type Role,
  type SectionRef,
  type SpaceId,
} from '@campuslink/shared';
import { useMe } from './me';
import { useTenant } from './tenant-context';
import { useUnreadMessages, useUnreadNotifications } from './unread';

/**
 * The five spaces' icons: the only navigation icons in the first load. Every other destination's
 * icon is in `lib/nav-icons.ts`, for the surfaces that load later.
 */
export const SPACE_ICONS: Record<SpaceId, LucideIcon> = {
  home: Home,
  learn: BookOpen,
  mentors: Compass,
  career: BriefcaseBusiness,
  you: User,
  mentoring: HeartHandshake,
  jobs: BriefcaseBusiness,
  community: Users,
  today: ClipboardCheck,
  students: GraduationCap,
  placements: Building2,
  content: Library,
  college: Settings,
  colleges: Building2,
  billing: ReceiptIndianRupee,
  traction: TrendingUp,
  health: Activity,
  settings: Settings,
  postings: BriefcaseBusiness,
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
  'outcomes',
  'resume',
  'interviews',
  'readiness',
  'practice',
  'peers',
  'circles',
  // Prompt 2: G8's share and Campus Captain screens, G10's company pages, G11's Career Copilot (their
  // screens shipped, but the menu and palette never offered them).
  'share',
  'captain',
  'companies',
  'copilot',
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
  'alumni',
  'reels',
  'following',
  'saved',
  'leaderboard',
  'rewards',
  'profile',
  'settings',
  'admin',
  'verify',
  'help',
  'network',
]);
/** An employer's host (prompt 2, G12): the recruiter portal and the account's settings. */
const EMPLOYER_SHIPPED: ReadonlySet<NavId> = new Set<NavId>(['recruiter', 'settings']);
const PLATFORM_SHIPPED: ReadonlySet<NavId> = new Set<NavId>([
  'employers',
  'platform',
  'billing',
  'traction',
  'health',
  'platformSupport',
  'settings',
]);

/** A section of a space, as the shell lists it. */
export interface SectionEntry {
  key: SectionRef;
  to: string;
  label: string;
  /** Opens once the member is verified; the screen says so. */
  locked: boolean;
  badge: number;
}

/** One of the member's spaces: a bottom tab on phones, a sidebar entry on desktop. */
export interface SpaceEntry {
  id: SpaceId;
  to: string;
  label: string;
  icon: LucideIcon;
  /** The space opens on its own screen, which lists its sections. */
  hub: boolean;
  /** The screen that lists every section of the space. */
  browse: string;
  sections: SectionEntry[];
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

/** Role-aware navigation for every surface: the spaces, the account menu and the Create sheet. */
export function useNav() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const tenant = useTenant();
  // Employer hosts (prompt 2, G12) have no college features either: no feed, messages or palette.
  const platform = tenant.kind !== 'college';
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
      tenant.kind === 'employer'
        ? EMPLOYER_SHIPPED
        : platform
          ? PLATFORM_SHIPPED
          : featureShipped(COLLEGE_SHIPPED, tenant.features),
    );
    const badges: Partial<Record<NavId, number>> = {
      messages: unreadMessages,
      notifications: unreadNotifications,
    };
    const section = (x: NavSection): SectionEntry => {
      const admin = x.key.startsWith('admin:') ? (x.key.slice(6) as AdminSectionId) : null;
      const id = x.key as NavId;
      return {
        key: x.key,
        to: x.path,
        label: admin
          ? t(`admin.${ADMIN_LABEL[admin] ?? admin}`)
          : // The admin area's own screen is the staff's overview; "Admin" is the area, not a place.
            id === 'admin'
            ? t('admin.overview')
            : t(`nav.${LABEL_KEY[id] ?? id}`),
        locked: x.locked,
        badge: admin ? 0 : (badges[id] ?? 0),
      };
    };
    const fallback =
      tenant.kind === 'platform' ? '/platform' : tenant.kind === 'employer' ? '/recruiter' : '/home';
    return {
      persona: model.persona,
      /** The member's spaces, in tab order (prompt 3, U2). */
      spaces: model.spaces.map((s): SpaceEntry => {
        const sections = s.sections.map(section);
        return {
          id: s.id,
          to: s.path,
          label: t(`nav.spaces.${s.id}`),
          icon: SPACE_ICONS[s.id],
          hub: s.hub,
          browse: s.browse,
          sections,
          // The inbox has its own entry in the top bar: a space does not repeat its count.
          badge: 0,
        };
      }),
      /** The model itself, for `spaceOf()`. */
      model: model.spaces,
      /** Where this member starts: Career in the final years, Learn in the first, else the first space. */
      landing: landingPath(model, fallback),
      create: model.create as CreateActionId[],
      /** The admin area's sections, grouped (its overview adds the icons). */
      admin: model.admin.map((g): AdminNavGroup => ({
        group: g.group,
        label: t(`admin.groups.${g.group}`),
        items: g.items.map((x) => ({ id: x.id, to: x.path, label: t(`admin.${ADMIN_LABEL[x.id] ?? x.id}`) })),
      })),
      /** The settings tab row: [path, label]. */
      settings: model.settings.map((x) => [x.path, t(SETTINGS_LABEL[x.id])] as const),
      unreadMessages,
      unreadNotifications,
      /** One count for the top bar's inbox: unread notifications and unread conversations. */
      inbox: unreadMessages + unreadNotifications,
      canMessage: permissions.includes('messages:send'),
    };
  }, [me, platform, tenant.kind, tenant.features, t, unreadMessages, unreadNotifications]);
}

/** Platform-aware shortcut hint for the command palette (⌘K on Apple devices). */
export function paletteShortcut(): string {
  const p = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/i.test(p) ? '⌘K' : 'Ctrl K';
}
