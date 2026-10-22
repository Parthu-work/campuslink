import { API_PREFIX, type ApiResponse } from '@campuslink/shared';
import { ApiError, refreshSession } from './api';
import { useSession } from './session';

/**
 * A multipart upload with progress (study material can be large). Same envelope, errors and one
 * token refresh as `apiRequest`; `fetch` cannot report upload progress, so this uses XHR.
 */
export function uploadWithProgress<T>(
  path: string,
  form: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  retried = false,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_PREFIX}${path}`);
    const token = useSession.getState().accessToken;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () =>
      reject(new ApiError(0, 'NETWORK', 'You seem to be offline. Check your connection and try again.'));
    xhr.onabort = () => reject(new ApiError(0, 'NETWORK', 'Upload cancelled'));
    xhr.onload = () => {
      if (xhr.status === 401 && token && !retried) {
        void refreshSession().then((ok) =>
          ok
            ? uploadWithProgress<T>(path, form, onProgress, signal, true).then(resolve, reject)
            : reject(new ApiError(401, 'UNAUTHENTICATED', 'Please sign in')),
        );
        return;
      }
      let body: ApiResponse<T> | null = null;
      try {
        body = JSON.parse(xhr.responseText) as ApiResponse<T>;
      } catch {
        /* not JSON */
      }
      if (!body)
        return reject(new ApiError(xhr.status, 'INTERNAL', 'Something went wrong. Please try again.'));
      if (!body.ok)
        return reject(
          new ApiError(
            xhr.status,
            body.error.code,
            body.error.message,
            body.error.details,
            body.error.requestId,
          ),
        );
      onProgress(1);
      resolve(body.data);
    };
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
