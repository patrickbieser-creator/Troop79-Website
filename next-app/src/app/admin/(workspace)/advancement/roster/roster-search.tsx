'use client';

/**
 * RosterSearch — the one name search for the whole roster (Patrick,
 * 2026-08-26: "one global name search above the tabs … results span
 * active/inactive scouts, leaders, adults; column 1 shows each match's
 * status/tab"; Jenna's spec 2026-08-27).
 *
 * It replaced the three per-tab SearchFields. Client-side over rows the page
 * already fetched (the "small, already-fetched list" canon in AGENTS.md —
 * not the URL-debounced `q` of Calendar/News/Ledger). While a query is
 * active the tab's table gives way to one result table across every tab and
 * the TabStrip is inert + dimmed — a control that does nothing must look
 * like it does nothing. Clearing brings the tab you were on straight back;
 * tab state never left the URL.
 *
 * A result row deep-links to `?tab=X&open=ID`, reusing the open-on-mount
 * wiring every tab already has — there is no second editor renderer here.
 */
import Link from 'next/link';
import { SearchField, useTableSearch } from '../../_components/search-field';
import { Badge } from '../../_components/badge';
import { ROSTER_KIND_LABEL, type RosterSearchRow } from './roster-search-rows';
import styles from './roster.module.css';

/** Module scope so the search hook's memo sees a stable matcher. Email and
 *  phone match quietly — a leader who remembers the address is not wrong. */
const searchFields = (r: RosterSearchRow) => [r.name, r.email, r.phone];

export function RosterSearch({
  rows,
  tabs,
  children
}: {
  rows: RosterSearchRow[];
  /** The TabStrip — rendered by the page, inerted here while searching. */
  tabs: React.ReactNode;
  /** The active tab's callouts + table — hidden while searching. */
  children: React.ReactNode;
}) {
  const { q, setQ, visible } = useTableSearch(rows, searchFields);
  const active = q.trim().length > 0;
  const dash = <span className={styles.muted}>—</span>;

  return (
    <>
      <div className={styles.tableToolbar}>
        <SearchField
          value={q}
          onChange={setQ}
          label="Search the roster"
          resultCount={visible.length}
          totalCount={rows.length}
        />
      </div>

      {active ? (
        <div inert className={styles.tabsInert} title="Clear search to browse by tab">
          {tabs}
        </div>
      ) : (
        tabs
      )}

      {active ? (
        <table className={styles.table} aria-label="Search results">
          <thead>
            <tr>
              <th>Status</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Household</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className={styles.muted}>
                  No one matches “{q.trim()}”.
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr key={r.key}>
                <td>
                  <Badge variant="neutral">{ROSTER_KIND_LABEL[r.kind]}</Badge>
                </td>
                <td>
                  <Link href={r.href} className={styles.nameBtn} title="Open on their tab">
                    {r.name}
                  </Link>
                </td>
                <td>{r.email || dash}</td>
                <td>{r.phone || dash}</td>
                <td>{r.detail || dash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        children
      )}
    </>
  );
}
