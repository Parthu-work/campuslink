/** A stable subject accent (1–8) for a name, so a person keeps their colour everywhere. */
export function accentOf(s: string) {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 9973;
  return (h % 8) + 1;
}

/** A soft cover in a person's own accent (profile and mentor headers): tokens only. */
export const coverOf = (name: string) => {
  const n = accentOf(name);
  return `linear-gradient(120deg, var(--subject-${n}-surface), color-mix(in oklch, var(--subject-${n}-ink) 22%, var(--surface-2)) 70%, var(--surface-2))`;
};
