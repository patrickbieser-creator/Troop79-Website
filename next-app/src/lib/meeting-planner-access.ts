/**
 * Who may do what on the public Meeting Planner (Plans/Meeting-Planner-II.md, Decisions 2–5). Pure and client-safe:
 * the page and every planner server action ask this one function with the resolved actor.
 *
 *   - View (any of the three rights): the whole board, everything on it, no controls (Decision 4).
 *   - Edit: answers for someone, assignments, offers, Meeting Live. The SPL holds it as a scout.
 *   - Seed: the planning team seeds meetings and keeps focus sets.
 *   - Email (requests, nudges, reminders) is adults only (Decision 5): an editor who signed in as a scout never sends.
 */
import type { AdminActor } from '@/lib/admin-actor';

export interface PlannerAccess {
  canView: boolean;
  canEdit: boolean;
  canSeed: boolean;
  canEmail: boolean;
}

export function plannerAccess(actor: Pick<AdminActor, 'capabilities' | 'subjectKind'> | null): PlannerAccess {
  const has = (c: 'view' | 'edit' | 'seed') => actor?.capabilities.has(`meeting_planner.${c}`) ?? false;
  const canEdit = has('edit');
  const canSeed = has('seed');
  return {
    canView: has('view') || canEdit || canSeed,
    canEdit,
    canSeed,
    canEmail: canEdit && actor?.subjectKind !== 'scout'
  };
}
