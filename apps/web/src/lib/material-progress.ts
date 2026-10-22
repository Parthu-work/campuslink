import { create } from 'zustand';
import type { MaterialProgressEvent } from '@campuslink/shared';

/** Live processing progress of materials this member uploaded (fed by the socket bridge). */
export const useMaterialProgress = create<{
  byId: Record<string, MaterialProgressEvent>;
  set: (e: MaterialProgressEvent) => void;
}>((set) => ({
  byId: {},
  set: (e) => set((s) => ({ byId: { ...s.byId, [e.materialId]: e } })),
}));
