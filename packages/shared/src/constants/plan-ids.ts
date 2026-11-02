/**
 * The plan ids (build B10), alone so schemas that only need the ids (a new college's plan) do not
 * pull the plan terms, GST tables and number words into every screen that loads them.
 */
export const PLAN_IDS = ['pilot', 'connect', 'placement'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
