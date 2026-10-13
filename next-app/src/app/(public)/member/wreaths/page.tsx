/**
 * /member/wreaths — "My wreath orders": the family's view of the wreath sale (Plans/Wreath-Sale.md, acceptance:
 * "orders, who has paid, a printable delivery list for distribution day, and earnings so far").
 *
 * Requires t79_identity, like /member/reimbursements. Scope is the family's scouts: an adult sees their children, a
 * scout sees themself, and the read-only superuser proxy (lib/member-viewer.ts) sees the chosen scout's household.
 * Only scouts who are sellers in the current sale get a section; troop-store orders never appear. Customer address
 * and phone are shown only on the rows a scout delivers (lib/wreaths/my-orders.ts). No form here writes anything.
 */
import Link from 'next/link';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveFamilyScope } from '@/lib/household-scope';
import { resolveMemberViewer, loadProxyFamily } from '@/lib/member-viewer';
import { loadMyWreathOrders } from '@/lib/wreaths/my-orders';
import { MemberProxyBanner } from '../member-proxy-banner';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import memberStyles from '../member.module.css';
import { MyWreathOrdersView } from './wreath-orders-view';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'My wreath orders — Scout Troop 79'
};

function SignInPrompt() {
  return (
    <>
      <PageHeader kicker="Members" title="Sign In" />
      <PageShell width="narrow">
        <div className={memberStyles.gate}>
          <p>Sign in to see your scout&rsquo;s wreath orders.</p>
          <p className={memberStyles.gapTopLg}>
            <Button variant="primary" href={`/signin?next=${encodeURIComponent('/member/wreaths')}`}>
              Sign in
            </Button>
          </p>
        </div>
      </PageShell>
    </>
  );
}

export default async function MyWreathOrdersPage({ searchParams }: { searchParams: Promise<{ viewScout?: string }> }) {
  const { viewScout } = await searchParams;
  const supabase = createAdminClient();
  const viewer = await resolveMemberViewer(supabase, viewScout);
  const proxy = viewer.kind === 'proxy' ? viewer : null;
  const session = await getIdentitySessionIfValid();

  if (viewer.kind === 'proxy-available') {
    return (
      <>
        <PageHeader kicker="Members" title="My wreath orders" />
        <PageShell>
          <MemberProxyBanner viewer={viewer} />
        </PageShell>
      </>
    );
  }

  if (!proxy && (!session || !(await isEpochCurrent(supabase, session)))) {
    return <SignInPrompt />;
  }

  const scope = proxy
    ? (await loadProxyFamily(proxy.personId)).personIds
    : await resolveFamilyScope(supabase, session!.personId, session!.subjectKind);
  const data = await loadMyWreathOrders(supabase, scope);

  return (
    <>
      <PageHeader kicker="Members" title="My wreath orders" />
      <PageShell>
        <MemberProxyBanner viewer={viewer} />
        <p className={memberStyles.intro}>
          Every wreath order placed through your scout&rsquo;s link: who has paid, what is still owed, and what your scout has earned.{' '}
          <Link href={proxy ? `/member?viewScout=${proxy.personId}` : '/member'}>← Back to Members</Link>
        </p>
        <MyWreathOrdersView data={data} />
      </PageShell>
    </>
  );
}
