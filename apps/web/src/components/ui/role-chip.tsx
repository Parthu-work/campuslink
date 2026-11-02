import { useTranslation } from '../../i18n/react';
import { cn } from '../../lib/cn';

/** Which of the four role colours (palette.ts ROLE_HUES) a role wears. */
const TONE: Record<string, 'student' | 'alumni' | 'faculty' | 'admin'> = {
  STUDENT: 'student',
  ALUMNI: 'alumni',
  FACULTY: 'faculty',
  TPO: 'faculty',
  COLLEGE_ADMIN: 'admin',
  MODERATOR: 'admin',
};
const CLASSES = {
  student: 'bg-role-student-surface text-role-student-ink',
  alumni: 'bg-role-alumni-surface text-role-alumni-ink',
  faculty: 'bg-role-faculty-surface text-role-faculty-ink',
  admin: 'bg-role-admin-surface text-role-admin-ink',
} as const;

/** A member's role as a coloured chip (profiles, author lines): the same colour for a role everywhere. */
export function RoleChip({ role, className }: { role: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex min-h-6 items-center rounded-full px-2.5 text-caption font-semibold',
        CLASSES[TONE[role] ?? 'student'],
        className,
      )}
    >
      {t(`role.${role}`)}
    </span>
  );
}
