/**
 * The line under a menu's title on its Plan, Shopping and meal pages (Phase 3):
 * whose menu it is and that it is read-only, Copy to My menus for another
 * scout, how many recipes aren't shared yet, and — on the Plan page — the
 * leader's review note (the one notice box, UI pattern of record). The owner
 * sees only the note. Everything here comes from the redacted view, so a
 * shared viewer never gets the note.
 */

import { Notice } from '@/app/_components/notice';
import { fmtDate } from '@/lib/format-date';
import { CopyMenuButton } from './copy-menu-button';
import { canRecord } from '@/lib/menu-monster/menu-access';
import { ReadOnlyLine } from './read-only-line';
import type { ViewableMenu } from './scout-menus';
import s from './workspace.module.css';

export function ViewerAside({ view, page }: { view: ViewableMenu; page: 'people' | 'plan' | 'shopping' | 'meal' | 'gear' | 'bought' | 'receipt' | 'conversions' }) {
  const { readOnly, plannedBy, hiddenRecipes, canCopy, stored } = view;
  const review = page === 'plan' ? stored.review : null;
  return (
    <>
      {/* A leader fixing someone's menu: whose it is, and that their changes save. */}
      {view.helping && <p className={s.foot}>{plannedBy ? `Planned by ${plannedBy} · You’re editing it as a leader` : 'You’re editing it as a leader'}</p>}
      {/* The owner, after a leader's save: told once, until their own next save. */}
      {view.leaderEditBy && stored.leaderEdit && (page === 'people' || page === 'plan' || page === 'shopping') && (
        <Notice tone="info" className={s.notice}>
          {view.leaderEditBy} changed this menu on {fmtDate(stored.leaderEdit.at)}.
        </Notice>
      )}
      {readOnly && (
        <div className={s.listHead}>
          <ReadOnlyLine plannedBy={plannedBy} writable={(page === 'gear' || page === 'bought' || page === 'receipt') && canRecord(view.access)} />
          {canCopy && <CopyMenuButton menuId={stored.id} />}
        </div>
      )}
      {readOnly && hiddenRecipes > 0 && (
        <p className={s.foot}>
          {hiddenRecipes === 1 ? '1 recipe in this menu isn’t shared yet.' : `${hiddenRecipes} recipes in this menu aren’t shared yet.`}
        </p>
      )}
      {review && (
        <Notice tone="info" className={s.notice}>
          <strong>Leader’s note</strong> ({fmtDate(review.at)}): {review.note}
        </Notice>
      )}
    </>
  );
}
