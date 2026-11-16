/**
 * /admin/reports/missing-bsa-ids — active scouts and adult leaders with no BSA member ID (Plans/Admin-Portal-Nav.md
 * decision 11). Home's Missing BSA IDs tile opens it. A missing ID blocks the Scoutbook export, so each name opens the
 * person's record to add it. roster.manage, like the record it links to.
 */
import Link from 'next/link';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { loadMissingBsaIds, type MissingBsaPerson } from '@/lib/missing-bsa-ids';
import { PageTitle } from '../../_components/page-title';
import styles from './missing-bsa-ids.module.css';

export const metadata = { title: 'Missing BSA IDs — Troop 79' };

function Group({ title, people, empty, detailLabel }: { title: string; people: MissingBsaPerson[]; empty: string; detailLabel: string }) {
  return (
    <section className={styles.group} aria-labelledby={`missing-${title}`}>
      <h2 id={`missing-${title}`} className={styles.heading}>
        {title} <span className={styles.count}>{people.length}</span>
      </h2>
      {people.length === 0 ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>{detailLabel}</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.personId}>
                  <td>
                    <Link href={`/admin/advancement/roster/${p.personId}`}>{p.name}</Link>
                  </td>
                  <td>{p.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default async function MissingBsaIdsPage() {
  await requireCapability('roster.manage');
  const missing = await loadMissingBsaIds(createAdminClient());
  return (
    <>
      <PageTitle
        back={{ label: 'Reports', href: '/admin/reports' }}
        title="Missing BSA IDs"
        sub="Active scouts and adult leaders with no BSA member ID. Scoutbook needs one for every award. Open a name to add it."
      />
      <Group title="Scouts" people={missing.scouts} empty="Every active scout has a BSA ID." detailLabel="Rank" />
      <Group title="Adult leaders" people={missing.leaders} empty="Every adult leader has a BSA ID." detailLabel="Position" />
    </>
  );
}
