import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { announceSignOut, api } from './api';
import { clearDrafts } from './drafts';
import { useSession } from './session';
import { clearRecent } from './recent';

export function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const signedOut = useSession((s) => s.signedOut);
  return async () => {
    await api.post('/auth/logout', undefined, true).catch(() => undefined);
    announceSignOut();
    signedOut(true);
    qc.clear();
    clearDrafts();
    clearRecent();
    navigate('/sign-in', { replace: true });
  };
}
