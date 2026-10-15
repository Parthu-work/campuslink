import mongoose, { type Query } from 'mongoose';

/**
 * The only sanctioned way to use $text. The global sanitizeFilter (NoSQL-injection defence) rejects
 * operators; here the $text clause is built server-side and marked trusted, while the user's term is
 * passed as a plain, length-capped string. Callers must never pass user-controlled objects.
 */
export function withTextSearch<Q extends Query<unknown, unknown>>(query: Q, term: string): Q {
  if (typeof term !== 'string' || term.length > 100) throw new Error('Invalid search term');
  return query.where({ $text: mongoose.trusted({ $search: term }) }) as Q;
}
