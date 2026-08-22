import Link from 'next/link';
import { publicScoutName } from '@/lib/scout-name';
import { optionalityLabel, type ReqNode } from '@/lib/mb-helpers';
import { rankLabel, type MbScoutLike, type MbScoutSlot, type MbGridGroups } from '@/lib/mb-scout-progress';
import s from './mb-tracker.module.css';

/**
 * The scout × requirement grid, moved here from the retired
 * /merit-badges/[mbId] (2026-08-22).
 *
 * PRESENTATIONAL ONLY — props in, markup out. Every decision it used to make
 * inline now lives in lib/mb-scout-progress.ts, which is tested; what is left
 * here is a table.
 *
 * SCOUT NAMES are `publicScoutName()` — first name + last initial. That
 * treatment moves with the grid and is not ours to relax: this page is public
 * and is advertised in the sitemap. Patrick confirmed the display on
 * 2026-08-22; the FORM of it is what keeps it defensible.
 *
 * Rows link to /scouts/[id]. The retired grid linked to /advancement/{id},
 * which is not a route — those were 404s on the live site, so this is a bug
 * fix riding along with the move, not a change of destination.
 *
 * A DELIBERATELY SEPARATE RENDERER from the admin grid at
 * /admin/advancement/mb-progress/[mbId], which looks similar and is not: every
 * admin cell is a link into Fast Entry for one-click sign-off, it shows full
 * display names, and it lives on admin tokens. Same numbers, different job —
 * the shared part is the fold, and that is already shared.
 */
export function MbScoutGrid({
  scouts,
  byScout,
  leaves,
  groups
}: {
  scouts: MbScoutLike[];
  byScout: ReadonlyMap<string, MbScoutSlot>;
  leaves: ReqNode[];
  groups: MbGridGroups;
}) {
  return (
    <div className={s.gridScroller}>
      <table className={s.grid}>
        <thead>
          <tr>
            <th rowSpan={2} className={s.scoutHead}>
              Scout
            </th>
            <th className={s.awardHead} title="Full merit badge earned">
              AWARD
            </th>
            {groups.groups.map((g) => (
              <th
                key={g.topCode}
                colSpan={g.spans}
                title={`Req ${g.topCode} — ${g.topNode.label}`}
                className={s.groupHead}
              >
                Req {g.topCode}
                {optionalityLabel(g.topNode) && (
                  <span className={s.groupRule}>{optionalityLabel(g.topNode)}</span>
                )}
              </th>
            ))}
          </tr>
          <tr>
            {/* Award's row-2 band — same padding/font as .leafHead so its
                combined height with the row above matches the Req-group
                columns exactly, instead of a rowSpan={2} cell leaving
                mismatched blank space against the gold fill. */}
            <th className={s.awardSubHead} aria-hidden="true" />
            {leaves.map((l) => (
              <th
                key={l.code}
                title={`${l.code} — ${l.label}`}
                className={
                  groups.groupStartCodes.has(l.code) ? `${s.leafHead} ${s.groupStart}` : s.leafHead
                }
              >
                {l.code}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scouts.map((sc) => {
            const slot = byScout.get(sc.id);
            if (!slot) return null;
            const name = publicScoutName(sc);
            const rank = rankLabel(sc.current_rank);
            return (
              <tr key={sc.id}>
                <td className={s.scoutCell}>
                  <Link href={`/scouts/${sc.id}`}>{name}</Link>
                  {rank && <span className={s.rankPill}>{rank}</span>}
                </td>
                <td
                  title={`${name} — ${slot.awarded ? 'badge earned' : 'not yet awarded'}`}
                  className={slot.awarded ? `${s.awardCell} ${s.awardCellDone}` : s.awardCell}
                >
                  {slot.awarded ? '★' : '☆'}
                </td>
                {leaves.map((l) => {
                  const done = slot.codes.has(l.code);
                  const cls = [
                    s.cell,
                    done ? s.cellDone : null,
                    groups.groupStartCodes.has(l.code) ? s.groupStart : null
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <td key={l.code} title={`${name} — ${l.code} — ${l.label}`} className={cls}>
                      {done ? '■' : '□'}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
