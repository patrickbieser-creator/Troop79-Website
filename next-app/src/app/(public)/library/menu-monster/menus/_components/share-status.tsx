/**
 * Where a shared menu shows, said once for the owner's Share tab and the
 * leader's Review tab (Phase 3). An outing that isn't published hides the menu
 * from everyone but the owner, leaders and parents (specialist review), and the
 * line says so instead of claiming it is on the shelf.
 */

import { fmtDate } from '@/lib/format-date';
import s from './workspace.module.css';

export interface ShareStatus {
  sharedAt: string | null;
  outingTitle: string | null;
  /** null = no outing linked. */
  outingPublished: boolean | null;
}

export function ShareStatusLine({ status, owner }: { status: ShareStatus; owner: boolean }) {
  if (!status.sharedAt) {
    return (
      <p className={s.foot} role="status">
        {owner ? 'Only you, your parents and the troop’s leaders can see this menu.' : 'Not shared.'}
      </p>
    );
  }
  const since = `Shared with the troop since ${fmtDate(status.sharedAt)}`;
  if (status.outingPublished === false) {
    return (
      <p className={s.foot} role="status">
        {since}, but its outing isn’t published yet, so only you, your parents and leaders can see it until it is.
      </p>
    );
  }
  return (
    <p className={s.foot} role="status">
      {since}. It shows on the Menu Monster page{status.outingTitle ? ` and on the page for ${status.outingTitle}` : ''}.
    </p>
  );
}
