import { IconResources, IconClaim, IconSuggest } from './mb-icons';
import s from './mb-tracker.module.css';

/**
 * One quiet line at the top of the Requirements list naming the row icons
 * in the order they appear on a row (Patrick, 2026-09-07, "reduce the
 * noise" — this replaced the old Done / Pending / Not yet / Pinned strip).
 * "I did this" drops out for a viewer who can never claim (a visitor, a
 * proxying leader), so the legend never promises an icon the rows won't show.
 */
export function MbLegend({ showClaim }: { showClaim: boolean }) {
  return (
    <p className={s.legend}>
      <span>
        <IconResources /> View resources · shown when a requirement has any
      </span>
      {showClaim && (
        <span>
          <IconClaim /> I did this · shown until this scout is done
        </span>
      )}
      <span>
        <IconSuggest /> Suggest a resource · always
      </span>
    </p>
  );
}
