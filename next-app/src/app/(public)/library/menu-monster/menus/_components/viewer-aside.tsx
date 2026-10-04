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

export function ViewerAside({ view, page }: { view: ViewableMenu; page: 'plan' | 'shopping' | 'meal' | 'gear' }) {
  const { readOnly, plannedBy, hiddenRecipes, canCopy, stored } = view;
  const review = page === 'plan' ? stored.review : null;
  return (
    <>
      {readOnly && (
        <div className={s.listHead}>
          <ReadOnlyLine plannedBy={plannedBy} writable={page === 'gear' && canRecord(view.access)} />
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
