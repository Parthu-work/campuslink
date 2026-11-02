import type { AnnouncementAudience, PostView } from '@campuslink/shared';

/** The composer's announcement options (B6); `years` is what the member typed ("2026, 2027"). */
export interface AnnouncementOptionsValue {
  branches: AnnouncementAudience['branches'];
  years: string;
  roles: AnnouncementAudience['roles'];
  pinDays: number;
  sendWhatsApp: boolean;
  urgent: boolean;
}

export const NO_ANNOUNCEMENT_OPTIONS: AnnouncementOptionsValue = {
  branches: [],
  years: '',
  roles: [],
  pinDays: 0,
  sendWhatsApp: false,
  urgent: false,
};

/** The post body fields for these options; nothing picked sends no audience (everyone). */
export function announcementFields(o: AnnouncementOptionsValue) {
  const gradYears = [
    ...new Set(
      o.years
        .split(/[\s,]+/)
        .map(Number)
        .filter((y) => Number.isInteger(y) && y >= 1950 && y <= 2100),
    ),
  ];
  const targeted = o.branches.length > 0 || gradYears.length > 0 || o.roles.length > 0;
  return {
    ...(targeted ? { audience: { branches: o.branches, gradYears, roles: o.roles } } : {}),
    ...(o.pinDays ? { pinDays: o.pinDays } : {}),
    sendWhatsApp: o.sendWhatsApp,
    urgent: o.sendWhatsApp && o.urgent,
  };
}

/** "ECE, CSE · 2027 · Students" for an announcement's audience badge; null for everyone. */
export function audienceLabel(a: PostView['audience'], roleName: (r: string) => string): string | null {
  if (!a) return null;
  return [a.branches.join(', '), a.gradYears.join(', '), a.roles.map(roleName).join(', ')]
    .filter(Boolean)
    .join(' · ');
}
