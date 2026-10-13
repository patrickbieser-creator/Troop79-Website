/**
 * "Needs you today" — Home's inbox (Plans/Admin-Home-And-Nav.md, Brad's prototype). One row per queue: a count, what
 * it counts, one line of who/what, and the whole row is the link to the queue that clears it. Presentational only
 * (no hooks, no data access) so the styleguide can render the same component with sample rows; the rows come from
 * loadAttentionCategories().
 */
import Link from 'next/link';
import styles from './attention-inbox.module.css';

export interface InboxRow {
  key: string;
  label: string;
  count: number;
  unit: string;
  meta: string;
  href: string;
  tone?: 'money';
}

export function AttentionInbox({ rows }: { rows: InboxRow[] }) {
  return (
    <section aria-labelledby="needs-you-today">
      <h2 className={styles.heading} id="needs-you-today">
        Needs you today
      </h2>
      {rows.length === 0 ? (
        <div className={styles.inbox}>
          <div className={styles.empty}>
            <span className={styles.ok} aria-hidden="true">
              ✓
            </span>
            <div>
              <b>Nothing needs you today.</b>
              <span>Submissions, reimbursements and sign-ups that need a decision will show up here.</span>
            </div>
          </div>
        </div>
      ) : (
        <ul className={styles.inbox}>
          {rows.map((r) => (
            <li key={r.key}>
              <Link href={r.href} className={`${styles.row} ${r.tone === 'money' ? styles.money : ''}`}>
                <span className={styles.count}>
                  <b>{r.count}</b>
                  <small>{r.unit}</small>
                </span>
                <span>
                  <span className={styles.title}>{r.label}</span>
                  {r.meta && <span className={styles.meta}>{r.meta}</span>}
                </span>
                <span className={styles.go} aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
