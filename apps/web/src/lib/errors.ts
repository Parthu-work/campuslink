import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

/** Maps an API error onto the form: field-level details where possible, otherwise a root message. */
export function applyApiError<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fallback: string,
  passwordField?: Path<T>,
) {
  if (err instanceof ApiError) {
    if (err.code === 'WEAK_PASSWORD' && passwordField) {
      const detail = Array.isArray(err.details) ? ` ${(err.details as string[]).join(' ')}` : '';
      setError(passwordField, { message: `${err.message}.${detail}` });
      return;
    }
    if (err.code === 'VALIDATION_FAILED' && Array.isArray(err.details)) {
      for (const d of err.details as { path?: string; message?: string }[]) {
        if (d.path) setError(d.path as Path<T>, { message: d.message ?? err.message });
      }
    }
    setError('root' as Path<T>, { message: err.message });
    return;
  }
  setError('root' as Path<T>, { message: fallback });
}
