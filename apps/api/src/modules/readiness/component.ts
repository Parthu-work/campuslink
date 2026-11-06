import type { ReadinessAction, ReadinessComponentId } from '@campuslink/shared';

/** A student the score is computed for (from the profile read model). */
export interface ReadinessMember {
  userId: string;
  branch: string | null;
  gradYear: number | null;
}

/**
 * What a component found for one member. `fraction` is the share of its points earned (0 to 1).
 * The next action's `gain` is the share of the component it adds when done, when that is known in
 * advance (the service turns it into points); null when it is not.
 */
export interface ComponentResult {
  fraction: number;
  facts: Record<string, number | string | null>;
  next: (Omit<ReadinessAction, 'component' | 'gain'> & { gain: number | null }) | null;
}

/**
 * One component of the readiness score, in its own file under `components/` and registered with
 * `ReadinessService.register()` (like privacy hooks). It reads only through the owning module's
 * service. A member it returns no entry for (or null) is "not applicable": skipped, and the other
 * components' weights are scaled up to 100.
 */
export interface ReadinessComponent {
  id: ReadinessComponentId;
  compute(members: ReadinessMember[], now: Date): Promise<Map<string, ComponentResult | null>>;
}

export const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
