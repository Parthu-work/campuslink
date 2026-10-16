/** `<input type="datetime-local">` value (local time) for an ISO instant. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** ISO instant for a datetime-local value ('' when empty or invalid, which fails validation). */
export function fromLocalInput(v: string): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** Whether an event has ended (read at render time; the page refetches often enough). */
export const hasEnded = (endsAt: string) => new Date(endsAt).getTime() < Date.now();
