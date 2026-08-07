/**
 * /signin/verify — the link half of the challenge (Plans/Family-Identity-Auth.md
 * Phase 1). GET renders "Continue as {name}" and consumes NOTHING — a
 * corporate mail scanner that prefetches links on arrival cannot burn this
 * token before the human clicks (see lib/identity-challenge.ts's
 * peekTokenChallenge()). Only the POST below (confirmTokenAction) consumes.
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { peekTokenChallenge } from '@/lib/identity-challenge';
import { confirmTokenAction } from '../actions';
import styles from '../../library/library.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Confirm Sign In — Scout Troop 79'
};

export default async function SignInVerifyPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string; err?: string }>;
}) {
  const { token, err } = await searchParams;
  const target = token ? await peekTokenChallenge(createAdminClient(), token) : null;

  return (
    <>
      <div className={styles.pageHeader}>
        <p className={styles.kicker}>Sign In</p>
        <h1 className={styles.pageTitle}>Confirm Sign In</h1>
        <div className={styles.headRule} />
      </div>

      <main className={`${styles.main} ${styles.mainNarrow}`} style={{ maxWidth: 480 }}>
        <div className={styles.formCard}>
          {target ? (
            <>
              <p className={styles.fieldHint} style={{ marginBottom: 14, fontSize: 15 }}>
                Continue as <strong>{target.displayName}</strong>?
              </p>
              <form action={confirmTokenAction}>
                <input type="hidden" name="token" value={token} />
                <button className={styles.btnPrimary} type="submit">
                  Continue
                </button>
              </form>
            </>
          ) : (
            <>
              <p className={styles.fieldError}>
                {err
                  ? 'Something went wrong confirming that sign-in — try the code instead.'
                  : 'This link has expired or was already used.'}
              </p>
              <p style={{ marginTop: 12 }}>
                <Link className={styles.btnSecondary} href="/signin">
                  Back to Sign In
                </Link>
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}
