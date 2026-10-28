/**
 * /i/plan/<token>: the published plan's family link (Plans/Meeting-Planner-III.md, Decision 5; qa-lead 2026-10-28).
 * The GET only reads (inspectPlanPage writes nothing, so a mail scanner's prefetch spends nothing). It shows the
 * meeting's focus and options as last published and lets the recipient answer for their own scouts on this meeting;
 * no sign-in. A closed link (unknown, expired, revoked) reads the same to anyone and hands the client nothing about
 * who or which scouts; a superseded one points at the newer email. Headers (no-referrer, no-store, noindex) come from
 * next.config.ts's /i/:path* rule.
 */
import { headers } from 'next/headers';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { fmtDateFull } from '@/lib/format-date';
import { loadMeetingById } from '@/lib/meeting-board';
import { tooManyInviteFailures } from '@/lib/meeting-invites-db';
import { loadFamilyWeek } from '@/lib/family-week';
import { inspectPlanPage } from '@/lib/plan-pages';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { PlanPageClient } from './plan-page-client';
import styles from '../../../member/meeting/family-week.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'This Week’s Troop Meeting — Scout Troop 79',
  robots: { index: false, follow: false }
};

export default async function PlanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sb = createAdminClient();
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || null;
  const limited = await tooManyInviteFailures(sb, ip);
  const { state, page } = limited ? { state: 'closed' as const, page: null } : await inspectPlanPage(sb, token);
  const meeting = state === 'open' && page ? await loadMeetingById(sb, page.entryId) : null;
  if (state !== 'open' || !page || !meeting) {
    return (
      <>
        <PageHeader kicker="Troop Meeting" title="This week’s meeting" />
        <PageShell width="narrow">
          <p className={styles.closed}>
            {page?.reason === 'superseded'
              ? 'There’s a newer plan for this meeting. Use the link in the troop’s latest email.'
              : 'This link has closed.'}{' '}
            You can always <Link href="/member/meeting">sign in to the member page</Link> to answer.
          </p>
        </PageShell>
      </>
    );
  }
  const week = await loadFamilyWeek(sb, meeting, page.scoutIds, await loadAdvancementCatalog(), page.recipientId);
  return (
    <>
      <PageHeader kicker="Troop Meeting" title={fmtDateFull(meeting.date)} />
      <PageShell width="narrow">
        <PlanPageClient token={token.toLowerCase()} week={week} />
        <p className={styles.optionSub}>
          This page is for {page.recipientName}. If that isn&rsquo;t you, please don&rsquo;t answer here. <Link href="/member/meeting">Sign in</Link> for more.
        </p>
      </PageShell>
    </>
  );
}
