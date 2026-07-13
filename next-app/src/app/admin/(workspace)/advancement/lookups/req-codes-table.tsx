'use client';

/**
 * Internal Requirement Codes — read-only, but now windowed + searchable
 * (previously a hard "first 50" server-side slice with no way to see the
 * rest). Tree editing still ships in a later slice.
 */

import { useLookupTable } from './use-lookup-table';
import styles from './lookups.module.css';

export interface ReqRow {
  source: 'rank' | 'mb';
  parentId: string;
  parentLabel: string;
  code: string;
  label: string;
}

export function ReqCodesTable({ rows }: { rows: ReqRow[] }) {
  const t = useLookupTable(rows, (r) => `${r.code} ${r.label} ${r.parentLabel}`);
  return (
    <>
      {t.searchEl}
      <div className={t.scrollClass}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={`${r.source}-${r.parentId}-${r.code}`}>
                <td className={styles.codeCell}>{r.code}</td>
                <td>{r.label}</td>
                <td>
                  <span className={`${styles.tag} ${r.source === 'rank' ? styles.tagRank : styles.tagMb}`}>
                    {r.source === 'rank' ? 'Rank' : 'MB'}: {r.parentLabel}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.footerEl}
    </>
  );
}
