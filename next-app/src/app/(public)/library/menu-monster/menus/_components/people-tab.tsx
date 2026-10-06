'use client';

/**
 * The Who's eating step on its own screen (Patrick, 2026-10-06). The draft, Save / Discard rail, summary rail
 * and leave guard are PlanTab's — one engine for both screens of one menu — so this is PlanTab on its "people"
 * page: the form (whos-eating.tsx) always open, no summary line, no Edit toggle. A new menu starts here and
 * its first Save lands on the Meals step.
 */

import { PlanTab, type PlanTabProps } from './plan-tab';

export type PeopleTabProps = Omit<PlanTabProps, 'page'>;

export function PeopleTab(props: PeopleTabProps) {
  return <PlanTab {...props} page="people" />;
}
