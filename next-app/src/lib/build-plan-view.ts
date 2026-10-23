/**
 * Build a Plan's sub-views (Patrick, 2026-10-22): the plan, Suggestions, and the three adds, each linkable as
 * `?view=…` so Back/Forward and shared links land on the same view. Plain module (no 'use client'): the page reads it
 * on the server, the client view on the client.
 */
export const ADD_VIEWS = ['add-requirement', 'add-set', 'new-mix'] as const;
export type AddView = (typeof ADD_VIEWS)[number];
export type BuildView = 'plan' | 'suggestions' | AddView;

/** The persistent bar's items, in order. Viewers (no Seed right) get the first two only. */
export const BUILD_NAV: readonly { view: BuildView; label: string }[] = [
  { view: 'plan', label: 'Plans' },
  { view: 'suggestions', label: 'Suggestions' },
  { view: 'add-requirement', label: 'Requirements' },
  { view: 'add-set', label: 'Focus sets' },
  { view: 'new-mix', label: 'A mix' }
];

/** Each sub-view's heading (focus lands on it when the view opens). */
export const VIEW_TITLE: Record<Exclude<BuildView, 'plan'>, string> = {
  suggestions: 'Suggestions',
  'add-requirement': 'Add a requirement',
  'add-set': 'Add a focus set',
  'new-mix': 'New mix'
};

export const isAddView = (v: string | null | undefined): v is AddView => (ADD_VIEWS as readonly string[]).includes(v ?? '');

/** `?view=` as a view: an add view needs the Seed right; anything unknown is the plan. */
export function parseBuildView(raw: string | string[] | null | undefined, canSeed: boolean): BuildView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === 'suggestions') return 'suggestions';
  if (isAddView(v)) return canSeed ? v : 'plan';
  return 'plan';
}

/** The URL of a view: the plan's own URL (`/planner/build?meeting=1`) plus `view=` for any other. */
export function viewHref(planHref: string, view: BuildView): string {
  if (view === 'plan') return planHref;
  return `${planHref}${planHref.includes('?') ? '&' : '?'}view=${view}`;
}
