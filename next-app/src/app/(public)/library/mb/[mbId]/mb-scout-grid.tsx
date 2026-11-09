import Link from 'next/link';
import { troopScoutName } from '@/lib/scout-name';
import { rankLabel, type MbScoutLike } from '@/lib/mb-scout-progress';
import type { CellState, GridRow, ProgressGrid } from '@/lib/mb-progress-grid';
import s from './mb-tracker.module.css';

/**
 * The Scout progress grid, Concept A2 (Plans/MB-Scout-Progress-Grid.md, 2026-11-08): a bracket over each choice,
 * one column per leaf requirement, done / still to do / not needed cells, a Progress column, and earned scouts
 * below a divider. Replaced the "Req N" header row and the AWARD star column.
 *
 * PRESENTATIONAL ONLY — every decision (rules, cell states, sort, counselor-only rows) lives in
 * lib/mb-progress-grid.ts, which is tested; what is left here is a table.
 *
 * SCOUT NAMES are `troopScoutName()` — first name + last initial for a visitor (this page is public and in the
 * sitemap), the full name for a signed-in troop member (`fullNames`, Patrick 2026-11-09).
 *
 * The admin MB Progress grid it once sat beside was retired 2026-11-09; this is the only scout grid for a badge.
 */

const STATE_WORDS: Record<CellState, string> = { done: 'done', open: 'still to do', notNeeded: 'not needed' };

export function MbScoutGrid({
  grid,
  highlightId,
  fullNames = false
}: {
  grid: ProgressGrid<MbScoutLike>;
  highlightId: string | null;
  /** A signed-in troop member: show last names. */
  fullNames?: boolean;
}) {
  const cols = grid.columns.length;
  const rows = [...grid.inProgress, ...grid.earned];
  const firstEarned = grid.inProgress.length > 0 ? grid.earned[0]?.scout.id : undefined;
  return (
    <div className={s.gridCard}>
      <ul className={s.legend} aria-label="Key">
        <li>
          <span className={s.boxDone} aria-hidden="true">
            ✓
          </span>
          Done
        </li>
        <li>
          <span className={s.boxOpen} aria-hidden="true" />
          Still to do
        </li>
        <li>
          <span className={s.dash} aria-hidden="true">
            –
          </span>
          Not needed, another option done
        </li>
      </ul>
      <div className={s.gridScroller}>
        <table className={s.grid}>
          <thead>
            <tr>
              <th rowSpan={2} scope="col" className={s.scoutHead}>
                Scout
              </th>
              {grid.brackets.map((b) => (
                <td key={b.code} colSpan={b.span} className={`${s.bracketCell} ${s.groupStart}`} aria-hidden="true">
                  {b.label && (
                    <>
                      <span className={s.bracketLabel}>{b.label}</span>
                      <span className={s.bracketLine} />
                    </>
                  )}
                </td>
              ))}
              <th rowSpan={2} scope="col" className={s.progressHead}>
                Progress
              </th>
            </tr>
            <tr>
              {grid.columns.map((c) => (
                <th
                  key={c.code}
                  scope="col"
                  aria-label={c.ariaName}
                  title={`${c.code} — ${c.label}`}
                  className={c.groupStart ? `${s.codeHead} ${s.groupStart}` : s.codeHead}
                >
                  {c.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <ScoutRow
                key={r.scout.id}
                row={r}
                grid={grid}
                cols={cols}
                divider={r.scout.id === firstEarned}
                highlighted={r.scout.id === highlightId}
                fullNames={fullNames}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScoutRow({
  row,
  grid,
  cols,
  divider,
  highlighted,
  fullNames
}: {
  row: GridRow<MbScoutLike>;
  grid: ProgressGrid<MbScoutLike>;
  cols: number;
  divider: boolean;
  highlighted: boolean;
  fullNames: boolean;
}) {
  const name = troopScoutName(row.scout, fullNames);
  const rank = rankLabel(row.scout.current_rank);
  const cls = [s.row, divider ? s.dividerRow : null, highlighted ? s.highlightRow : null].filter(Boolean).join(' ');
  return (
    <tr className={cls} data-divider={divider ? 'true' : undefined} aria-current={highlighted ? 'true' : undefined}>
      <th scope="row" className={s.scoutCell}>
        <Link href={`/scouts/${row.scout.id}`}>{name}</Link>
        {rank && <span className={s.rank}>{rank}</span>}
      </th>
      {row.earned && !row.requirementsRecorded ? (
        <td colSpan={Math.max(cols, 1)} className={s.completeCell}>
          <span className={s.completeBar}>All requirements complete</span>
        </td>
      ) : (
        grid.columns.map((c, i) => {
          const state = row.cells[i];
          return (
            <td key={c.code} className={c.groupStart ? `${s.cell} ${s.groupStart}` : s.cell}>
              <span
                role="img"
                aria-label={`${c.code} ${STATE_WORDS[state]}`}
                className={state === 'done' ? s.boxDone : state === 'open' ? s.boxOpen : s.dash}
              >
                {state === 'done' ? '✓' : state === 'notNeeded' ? '–' : null}
              </span>
            </td>
          );
        })
      )}
      <td className={s.progressCell}>
        {row.earned ? (
          <span className={s.earnedPill}>Earned</span>
        ) : (
          <span className={s.progress}>
            <span className={s.progressText}>
              {row.met} of {row.total}
            </span>
            <progress className={s.progressBar} value={row.met} max={row.total} aria-hidden="true" />
          </span>
        )}
      </td>
    </tr>
  );
}
