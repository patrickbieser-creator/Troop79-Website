/**
 * /member/scout-account — a family's own scout-account balance and full
 * history (Plans/Troop-Finances.md Phase 3). Activates the "Scout account"
 * card on /member, which was a href-less "Soon" placeholder before this.
 *
 * Read-only, deliberately no export/CSV affordance — that's a treasurer-only
 * feature (finance.manage), not a family one.
 *
 * Viewer resolution goes through lib/finance-viewer.ts's resolveFinanceViewer
 * — the finance counterpart to the Resource Library's superuser-proxy
 * pattern (Plans/Troop-Finances.md: "extend the superuser proxy logic... to
 * scout accounts on the public site"). A treasurer (finance.manage) can pick
 * any active scout via `?viewScout=`, the same shape as Library's
 * `?viewScout=` picker; a verified family sees their own household scope
 * (self ∪ children) with no picker needed, since every scope member already
 * renders at once.
 *
 * Requires t79_identity for the family path — no legacy FAMILY_PASSWORD
 * fallback, on purpose: the shared household-gate secret can't scope by
 * household, so serving this behind it would leak every family's balance to
 * every other family. This is the first page in the codebase to hard-require
 * real per-person identity rather than degrade to the shared troop password
 * (see Plans/Troop-Finances.md's access-design notes for why that's the
 * right call here specifically).
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveFinanceViewer } from '@/lib/finance-viewer';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { computeBalance } from '@/lib/finance';
import shell from '../../library/library.module.css';
import memberStyles from '../member.module.css';
import styles from './scout-account.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Scout Account — Scout Troop 79'
};

interface HistoryRow {
  id: number;
  occurred_on: string;
  amount: number;
  kind: string;
  activity_label: string | null;
  memo: string | null;
  person_id: number | null;
  voided_at: string | null;
}

function SignInPrompt({ heading, body }: { heading: string; body: string }) {
  return (
    <>
      <div className={shell.pageHeader}>
        <p className={shell.kicker}>Members</p>
        <h1 className={shell.pageTitle}>{heading}</h1>
        <div className={shell.headRule} />
      </div>
      <main className={`${shell.main} ${shell.mainNarrow}`}>
        <div className={memberStyles.gate}>
          <p>{body}</p>
          <p style={{ marginTop: '1.5rem' }}>
            <Link className={memberStyles.signInBtn} href={`/signin?next=${encodeURIComponent('/member/scout-account')}`}>
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}

export default async function ScoutAccountPage({
  searchParams
}: {
  searchParams: Promise<{ viewScout?: string }>;
}) {
  const { viewScout } = await searchParams;
  const supabase = createAdminClient();
  const viewer = await resolveFinanceViewer(supabase, viewScout);

  if (viewer.kind === 'none') {
    return (
      <SignInPrompt
        heading="Sign In"
        body="Sign in to see your scout's account — what's come in from fundraising and can drives, and what it's been spent on."
      />
    );
  }

  if (viewer.kind === 'proxy-available') {
    return (
      <>
        <div className={shell.pageHeader}>
          <p className={shell.kicker}>Members</p>
          <h1 className={shell.pageTitle}>Scout Account</h1>
          <div className={shell.headRule} />
        </div>
        <main className={`${shell.main} ${shell.mainNarrow}`}>
          <p className={memberStyles.intro}>
            Pick a scout to view their account exactly as their family sees it.
          </p>
          <form method="get" className={styles.proxyForm}>
            <select name="viewScout" defaultValue="" required>
              <option value="" disabled>
                Choose a scout&hellip;
              </option>
              {viewer.options.map((o) => (
                <option key={o.personId} value={o.personId}>
                  {o.name}
                </option>
              ))}
            </select>
            <button type="submit">View</button>
          </form>
        </main>
      </>
    );
  }

  // kind === 'scope'
  const { personIds: scope, label, switchOptions, isProxy } = viewer;

  const [{ data: people }, rows] = await Promise.all([
    supabase.from('people').select('id, display_name').in('id', scope),
    fetchAllRows<HistoryRow>((from, to) =>
      supabase
        .from('financial_transactions')
        .select('id, occurred_on, amount, kind, activity_label, memo, person_id, voided_at')
        .eq('account', 'scout_account')
        .in('person_id', scope)
        .order('occurred_on', { ascending: false })
        .range(from, to)
    )
  ]);

  const nameById = new Map<number, string>();
  for (const p of (people ?? []) as { id: number; display_name: string }[]) {
    nameById.set(p.id, p.display_name);
  }

  const balanceRows = scope.map((personId) => ({
    personId,
    name: nameById.get(personId) ?? `#${personId}`,
    balance: computeBalance(
      rows.map((r) => ({ account: 'scout_account' as const, amount: r.amount, person_id: r.person_id, voided_at: r.voided_at })),
      { account: 'scout_account', personId }
    )
  }));

  const multipleScouts = balanceRows.length > 1;

  return (
    <>
      <div className={shell.pageHeader}>
        <p className={shell.kicker}>Members</p>
        <h1 className={shell.pageTitle}>Scout Account</h1>
        <div className={shell.headRule} />
      </div>
      <main className={shell.main}>
        {isProxy && (
          <div className={styles.proxyBanner}>
            <span>
              Viewing as <strong>{label}</strong> (leader view)
            </span>
            <form method="get" className={styles.proxyForm}>
              <select name="viewScout" defaultValue={String(scope[0])}>
                {switchOptions.map((o) => (
                  <option key={o.personId} value={o.personId}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button type="submit">Switch</button>
            </form>
          </div>
        )}

        {!isProxy && switchOptions.length > 0 && (
          // finance.manage holder viewing their own family by default
          // (Patrick, 2026-08-18) — the switcher is offered, not forced.
          // Picking a scout here is what turns proxy mode on; returning to
          // /member and back resets to this default, no toggle to remember.
          <div className={styles.proxyBanner}>
            <span>Viewing your own family.</span>
            <form method="get" className={styles.proxyForm}>
              <select name="viewScout" defaultValue="">
                <option value="" disabled>
                  View another scout&hellip;
                </option>
                {switchOptions.map((o) => (
                  <option key={o.personId} value={o.personId}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button type="submit">View</button>
            </form>
          </div>
        )}

        <p className={memberStyles.intro}>
          What&rsquo;s come in from can drives, wreath sales, and other fundraising, and what it&rsquo;s
          been spent on. This is the same money the troop tracks internally — it never expires and rolls
          forward year to year. <Link href="/member">← Back to Members</Link>
        </p>

        <div className={styles.balanceGrid}>
          {balanceRows.map((b) => (
            <div key={b.personId} className={styles.balanceCard}>
              <p className={styles.balanceLabel}>{b.name}</p>
              <p className={styles.balanceValue}>${b.balance.toFixed(2)}</p>
            </div>
          ))}
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                {multipleScouts && <th>Scout</th>}
                <th>Activity</th>
                <th className={styles.numCell}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={multipleScouts ? 4 : 3} className={styles.empty}>
                    Nothing yet — activity will show up here as it happens.
                  </td>
                </tr>
              )}
              {rows
                .filter((r) => r.voided_at === null)
                .map((r) => (
                  <tr key={r.id}>
                    <td className={styles.nowrap}>{r.occurred_on}</td>
                    {multipleScouts && <td>{r.person_id != null ? (nameById.get(r.person_id) ?? '—') : '—'}</td>}
                    <td>{[r.activity_label, r.memo].filter(Boolean).join(' — ') || r.kind}</td>
                    <td className={styles.numCell}>
                      {r.amount < 0 ? `-$${Math.abs(r.amount).toFixed(2)}` : `$${r.amount.toFixed(2)}`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <p className={memberStyles.note}>
          Questions about a specific entry? Ask a leader — the troop treasurer can pull up the full detail.
        </p>
      </main>
    </>
  );
}
