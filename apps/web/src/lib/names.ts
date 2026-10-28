/** Courtesy titles that are not part of what people call someone ("Dr. Haritha Rao" → "Haritha"). */
const HONORIFIC = /^(dr|prof|mr|mrs|ms|smt|sri|shri|er)\.?$/i;

/** A person's name without a leading courtesy title. */
const words = (name: string) => {
  const all = name.trim().split(/\s+/).filter(Boolean);
  const rest = all.filter(
    (w, i) => !(i < all.length - 1 && HONORIFIC.test(w) && all.slice(0, i).every((p) => HONORIFIC.test(p))),
  );
  return rest.length ? rest : all;
};

/** What to call someone in a greeting or a short label. */
export const firstName = (name: string) => words(name)[0] ?? name;

/** Up to two initials for an avatar ("Dr. Haritha Rao" → "HR"). */
export const initialsOf = (name: string) =>
  words(name)
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
