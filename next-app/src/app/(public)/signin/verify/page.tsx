/**
 * /signin/verify — the link half of the challenge (Plans/Family-Identity-Auth.md
 * Phase 1). GET renders "Continue as {name}" and consumes NOTHING — a
 * corporate mail scanner that prefetches links on arrival cannot burn this
 * token before the human clicks (see lib/identity-challenge.ts's
 * peekTokenChallenge()). Only the POST below (confirmTokenAction) consumes.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { inspectTokenChallenge } from '@/lib/identity-challenge';
import { confirmTokenAction } from '../actions';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { FormCard, FieldHint } from '@/app/_components/form';
import pick from '../signin.module.css';

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
  const { state, target } = token
    ? await inspectTokenChallenge(createAdminClient(), token)
    : ({ state: 'unknown', target: null } as const);

  return (
    <>
      <PageHeader kicker="Sign In" title="Confirm Sign In" />

      <PageShell width="narrow" className={pick.shell}>
        <FormCard>
          {target ? (
            <>
              <FieldHint className={pick.confirmAs}>
                Continue as <strong>{target.displayName}</strong>?
              </FieldHint>
              <form action={confirmTokenAction}>
                <input type="hidden" name="token" value={token} />
                <Button variant="primary" type="submit">
                  Continue
                </Button>
              </form>
            </>
          ) : (
            <>
              {/* One message per state. "Expired or already used" covered
                  three situations, and the commonest — you already signed in
                  with the code from this same email — is not an error at all.
                  Reported as a bug 2026-08-16 by someone who read it as the
                  site being broken. */}
              <Notice tone="error">
                {err
                  ? 'Something went wrong confirming that sign-in — try the code instead.'
                  : state === 'consumed'
                    ? 'This link has already been used. If you signed in with the 6-digit code from the same email, that used it up — you may already be signed in.'
                    : state === 'expired'
                      ? 'This link has expired. Sign-in links last 15 minutes; request a fresh one and it’ll work.'
                      : 'We don’t recognise that link. It may have been broken across two lines by your email app — request a fresh one, or use the 6-digit code instead.'}
              </Notice>
              <p className={pick.gapTopSm}>
                <Button variant="secondary" href="/signin">
                  Back to Sign In
                </Button>
              </p>
            </>
          )}
        </FormCard>
      </PageShell>
    </>
  );
}
