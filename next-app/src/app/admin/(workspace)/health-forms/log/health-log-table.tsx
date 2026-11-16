'use client';

/** The access log as a searchable DataTable · Compact (Plans/Admin-Health-Forms.md; moved from /health/log). Read-only. */
import { fmtDateTime } from '@/lib/format-date';
import { SearchField, useTableSearch } from '../../_components/search-field';
import styles from '../health-forms.module.css';

export interface HealthLogRow {
  at: string;
  who: string;
  how: string;
  did: string;
  whose: string;
  doc: string;
}

const fields = (r: HealthLogRow) => [r.who, r.whose];

export function HealthLogTable({ rows }: { rows: HealthLogRow[] }) {
  const { q, setQ, visible } = useTableSearch(rows, fields);
  return (
    <>
      <div className={styles.toolbar}>
        <SearchField value={q} onChange={setQ} label="Search the log by who or whose" resultCount={visible.length} totalCount={rows.length} />
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>How in</th>
              <th>Did</th>
              <th>Whose</th>
              <th>Which document</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.empty}>
                  {rows.length === 0 ? 'Nothing has been logged yet.' : 'Nothing matches.'}
                </td>
              </tr>
            ) : (
              visible.map((r, i) => (
                <tr key={i}>
                  <td className={styles.logWhen}>{fmtDateTime(r.at)}</td>
                  <td>{r.who}</td>
                  <td>{r.how}</td>
                  <td>{r.did}</td>
                  <td>{r.whose}</td>
                  <td>{r.doc}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
