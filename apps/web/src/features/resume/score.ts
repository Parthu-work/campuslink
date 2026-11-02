/** Green from 75, amber from 50: the same bands the check's own wording uses. */
export const scoreTone = (n: number) => (n >= 75 ? 'success' : n >= 50 ? 'warning' : 'danger');
