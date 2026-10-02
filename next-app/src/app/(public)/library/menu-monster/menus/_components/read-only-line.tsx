/**
 * The line a leader sees under a scout's menu title: whose menu it is and that
 * it cannot be changed from here. Shared by the Plan, meal and Shopping pages.
 */

import s from './workspace.module.css';

export function ReadOnlyLine({ plannedBy }: { plannedBy?: string | null }) {
  return <p className={s.foot}>{plannedBy ? `Planned by ${plannedBy} · Read-only` : 'Read-only'}</p>;
}
