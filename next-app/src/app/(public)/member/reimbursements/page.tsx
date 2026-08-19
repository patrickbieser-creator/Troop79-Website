/**
 * /member/reimbursements — submit a reimbursement request and track your
 * own household's past ones (Plans/Troop-Finances.md Phase 4).
 *
 * Requires t79_identity, same as /member/scout-account and for the same
 * reason (household-scoped financial data, the shared FAMILY_PASSWORD can't
 * scope). Anyone verified may submit on their own behalf — no capability
 * needed, matching event-signup's "own-household actions need no grant"
 * rule. The visible list is household-scoped (resolveFamilyScope: self ∪
 * children) so a parent sees their scout's requests too, but withdrawal is
 * requester-only (enforced in actions.ts, not just hidden here).
 */
import Link from 'next/link';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveFamilyScope } from '@/lib/household-scope';
import { submitReimbursementAction, withdrawReimbursementAction } from './actions';
import shell from '../../library/library.module.css';
import memberStyles from '../member.module.css';
import styles from './reimbursements.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Reimbursements — Scout Troop 79'
};

interface RequestRow {
  id: number;
  requester_person_id: number;
  amount: number;
  description: string;
  status: string;
  denial_reason: string | null;
  decided_at: string | null;
  paid_at: string | null;
  created_at: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  auth: 'Your sign-in has been revoked or expired — sign in again to continue.',
  amount: 'Enter an amount greater than zero.',
  description: "Add a short description of what this was for — it's what the treasurer sees.",
  receipt: "Attach a receipt (JPEG, PNG, HEIC, WebP, or PDF, 10 MB max) — it's required.",
  save: 'Something went wrong saving that — try again, or ask a leader.'
};

function SignInPrompt() {
  return (
    <>
      <div className={shell.pageHeader}>
        <p className={shell.kicker}>Members</p>
        <h1 className={shell.pageTitle}>Sign In</h1>
        <div className={shell.headRule} />
      </div>
      <main className={`${shell.main} ${shell.mainNarrow}`}>
        <div className={memberStyles.gate}>
          <p>Sign in to submit a reimbursement request or check on one you already sent.</p>
          <p style={{ marginTop: '1.5rem' }}>
            <Link className={memberStyles.signInBtn} href={`/signin?next=${encodeURIComponent('/member/reimbursements')}`}>
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}

export default async function ReimbursementsPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { ok, err } = await searchParams;
  const supabase = createAdminClient();
  const session = await getIdentitySessionIfValid();

  if (!session || !(await isEpochCurrent(supabase, session))) {
    return <SignInPrompt />;
  }

  const scope = await resolveFamilyScope(supabase, session.personId, session.subjectKind);
  const { data: rows } = await supabase
    .from('reimbursement_requests')
    .select('id, requester_person_id, amount, description, status, denial_reason, decided_at, paid_at, created_at')
    .in('requester_person_id', scope)
    .order('created_at', { ascending: false });

  const requests = (rows ?? []) as RequestRow[];

  return (
    <>
      <div className={shell.pageHeader}>
        <p className={shell.kicker}>Members</p>
        <h1 className={shell.pageTitle}>Reimbursements</h1>
        <div className={shell.headRule} />
      </div>
      <main className={shell.main}>
        <p className={memberStyles.intro}>
          Paid for something out of pocket for the troop? Submit it here with a receipt, and the
          treasurer will review it. <Link href="/member">← Back to Members</Link>
        </p>

        {ok === '1' && <p className={styles.success}>Request submitted — the treasurer will review it.</p>}
        {ok === 'withdrawn' && <p className={styles.success}>Request withdrawn.</p>}
        {err && <p className={styles.error}>{ERROR_MESSAGES[err] ?? 'Something went wrong — try again.'}</p>}

        <form action={submitReimbursementAction} className={styles.form}>
          <label>
            Amount
            <input type="number" name="amount" min="0.01" step="0.01" required />
          </label>
          <label className={styles.wide}>
            What was this for?
            <textarea name="description" rows={2} required />
          </label>
          <label className={styles.wide}>
            Receipt
            <input type="file" name="receipt" accept="image/jpeg,image/png,image/heic,image/webp,application/pdf" required />
          </label>
          <button type="submit" className={memberStyles.signInBtn}>
            Submit request
          </button>
        </form>

        <h2 className={styles.historyHeading}>Your household&rsquo;s requests</h2>
        {requests.length === 0 ? (
          <p className={memberStyles.note}>Nothing submitted yet.</p>
        ) : (
          <ul className={styles.requestList}>
            {requests.map((r) => (
              <li key={r.id} className={styles.requestItem}>
                <div className={styles.requestHead}>
                  <span className={styles.requestAmount}>${r.amount.toFixed(2)}</span>
                  <span className={`${styles.statusTag} ${styles[`status_${r.status}`] ?? ''}`}>{r.status}</span>
                </div>
                <p className={styles.requestDesc}>{r.description}</p>
                {r.status === 'denied' && r.denial_reason && (
                  <p className={styles.denialReason}>Reason: {r.denial_reason}</p>
                )}
                {r.status === 'submitted' && r.requester_person_id === session.personId && (
                  <form action={withdrawReimbursementAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className={styles.withdrawBtn}>
                      Withdraw
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
