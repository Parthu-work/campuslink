import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useMaterialProgress } from './material-progress';
import { toast } from './toast';
import type {
  MaterialDetailView,
  MaterialProgressEvent,
  MessageView,
  NotificationView,
} from '@campuslink/shared';
import { connectRealtime, disconnectRealtime, useTyping } from './realtime';
import { useSession } from './session';

type MessagePage = { data: MessageView[]; meta?: { nextCursor?: string | null } };

/** Adds a message to the newest cached page of its conversation (no refetch, no duplicates). */
export function appendMessage(qc: ReturnType<typeof useQueryClient>, m: MessageView) {
  qc.setQueryData<InfiniteData<MessagePage>>(['messages', m.conversationId], (old) => {
    if (!old?.pages.length) return old;
    if (old.pages.some((p) => p.data.some((x) => x.id === m.id))) return old;
    const [first, ...rest] = old.pages;
    return {
      ...old,
      pages: [{ ...(first as MessagePage), data: [...(first as MessagePage).data, m] }, ...rest],
    };
  });
}

/** Connects the socket while signed in and turns server events into cache updates and toasts. */
export function useRealtimeBridge() {
  const status = useSession((s) => s.status);
  const qc = useQueryClient();
  const { t } = useTranslation();
  const navigate = useNavigate();
  useEffect(() => {
    if (status !== 'signed-in') {
      disconnectRealtime();
      return;
    }
    let s: Awaited<ReturnType<typeof connectRealtime>> | null = null;
    let cancelled = false;
    const onMessage = (m: MessageView) => {
      appendMessage(qc, m);
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['unread-messages'] });
    };
    const onRead = (r: { conversationId: string }) =>
      void qc.invalidateQueries({ queryKey: ['conversation', r.conversationId] });
    const onTyping = (x: { conversationId: string }) => useTyping.getState().mark(x.conversationId);
    const onNotification = (n: NotificationView) => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['notifications-unread'] });
      if (n.type.startsWith('request_')) void qc.invalidateQueries({ queryKey: ['requests'] });
      if (n.type.startsWith('booking_') || n.type === 'request_accepted' || n.type === 'session_completed')
        void qc.invalidateQueries({ queryKey: ['bookings'] });
      // No toast for the conversation already on screen.
      if (n.type === 'new_message' && window.location.pathname === `/messages/${n.data.conversationId ?? ''}`)
        return;
      // The wording loads with the first notification, not with the app (bundle budget).
      void import('./notification-text').then(({ notificationText }) => {
        const text = notificationText(t, n);
        toast(text.title, {
          description: text.body,
          action: { label: t('common.open'), onClick: () => void navigate(text.href) },
        });
      });
    };
    const onMaterial = (e: MaterialProgressEvent) => {
      useMaterialProgress.getState().set(e);
      qc.setQueryData<MaterialDetailView>(['material', e.materialId], (old) =>
        old ? { ...old, stage: e.stage, progress: e.progress, error: e.error } : old,
      );
      if (e.stage === 'indexed' || e.stage === 'failed') {
        void qc.invalidateQueries({ queryKey: ['material', e.materialId] });
        void qc.invalidateQueries({ queryKey: ['materials'] });
      }
    };
    void connectRealtime().then((socket) => {
      if (cancelled) return;
      s = socket;
      s.on('message:new', onMessage);
      s.on('message:read', onRead);
      s.on('typing', onTyping);
      s.on('notification:new', onNotification);
      s.on('study:material', onMaterial);
    });
    return () => {
      cancelled = true;
      s?.off('message:new', onMessage);
      s?.off('message:read', onRead);
      s?.off('typing', onTyping);
      s?.off('notification:new', onNotification);
      s?.off('study:material', onMaterial);
    };
  }, [status, qc, t, navigate]);
}
