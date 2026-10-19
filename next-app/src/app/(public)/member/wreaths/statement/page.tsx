/**
 * /member/wreaths/statement?scout=<personId> — a scout's wreath-sale Statement (Patrick, 2026-10-19): the same
 * line-by-line account as Admin › Wreath Sale › Reconciliation, for the viewer's own credited scout. Server-rendered,
 * read-only, printable.
 *
 * Authorization is lib/wreaths/statement (resolveStatementScope + canViewStatement): the scout must be in the scope
 * derived from the session (a family's own scouts; a finance.manage super user, every active seller; the read-only
 * Members proxy, the chosen household). Anyone else's scout is a 404, so the page never says whether the id exists.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { canViewStatement, loadScoutStatement, resolveStatementScope } from '@/lib/wreaths/statement';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import { EmptyState } from '@/app/_components/empty-state';
import { WreathStatementSection } from '@/app/_components/wreath-statement';
import memberStyles from '../../member.module.css';
import { PrintStatementButton } from './print-statement-button';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Wreath statement — Scout Troop 79' };

export default async function WreathStatementPage({ searchParams }: { searchParams: Promise<{ scout?: string; viewScout?: string }> }) {
  const { scout, viewScout } = await searchParams;
  const sb = createAdminClient();
  const scope = await resolveStatementScope(sb, viewScout);
  if (!scope) {
    const next = `/member/wreaths/statement${scout ? `?scout=${encodeURIComponent(scout)}` : ''}`;
    return (
      <>
        <PageHeader kicker="Members" title="Sign In" />
        <PageShell width="narrow">
          <div className={memberStyles.gate}>
            <p>Sign in to see your scout&rsquo;s wreath statement.</p>
            <p className={memberStyles.gapTopLg}>
              <Button variant="primary" href={`/signin?next=${encodeURIComponent(next)}`}>
                Sign in
              </Button>
            </p>
          </div>
        </PageShell>
      </>
    );
  }

  const personId = Number(scout);
  if (!canViewStatement(scope, personId)) notFound();
  const statement = await loadScoutStatement(sb, personId);
  if (!statement) notFound();

  const back = scope.proxyPersonId != null ? `/member/wreaths?viewScout=${scope.proxyPersonId}` : '/member/wreaths';
  return (
    <>
      <PageHeader kicker="Members" title="Wreath statement" />
      <PageShell>
        <p className={memberStyles.intro}>
          Every order credited to {statement.name.split(' ')[0]}, line by line: what it cost the troop, the profit, and each share.{' '}
          <Link href={back}>← Back to My wreath orders</Link>
        </p>
        <p className={memberStyles.intro}>
          <PrintStatementButton />
        </p>
        {statement.section ? (
          <WreathStatementSection section={statement.section} year={statement.year} settings={statement.settings} asOf={new Date().toISOString()} printRoot />
        ) : (
          <EmptyState>No orders yet. Orders credited to {statement.name.split(' ')[0]} will be listed here.</EmptyState>
        )}
      </PageShell>
    </>
  );
}
