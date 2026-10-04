/**
 * The line a leader sees under a scout's menu title: whose menu it is and that
 * it cannot be changed from here. Shared by the Plan, meal and Shopping pages.
 */

import s from './workspace.module.css';

export function ReadOnlyLine({ plannedBy, writable = false }: { plannedBy?: string | null; /** The viewer can still act here (tick gear, record what was bought): no "Read-only". */ writable?: boolean }) {
  if (writable) return plannedBy ? <p className={s.foot}>Planned by {plannedBy}</p> : null;
  return <p className={s.foot}>{plannedBy ? `Planned by ${plannedBy} · Read-only` : 'Read-only'}</p>;
}
