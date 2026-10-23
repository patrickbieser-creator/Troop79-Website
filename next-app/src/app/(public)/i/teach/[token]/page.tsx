/**
 * /i/teach/<token>: a teacher's ONE answer page for a meeting (Build a Plan B10b). The GET only reads
 * (inspectTeachPage writes nothing, so a mail scanner's prefetch spends nothing) and shows only what the email's send
 * snapshotted; answers go by POST (answerTeachPageAction). No sign-in: the link answers that teacher's classes on this
 * page and nothing else. Headers (no-referrer, no-store, noindex) come from next.config.ts's /i/:path* rule.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { fmtDateFull } from '@/lib/format-date';
import { inspectTeachPage } from '@/lib/meeting-teach-pages';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { TeachPageCard } from './teach-page-card';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Choose What You’ll Teach — Scout Troop 79',
  robots: { index: false, follow: false }
};

export default async function TeachPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ err?: string; saved?: string; failed?: string }> }) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const { state, page } = await inspectTeachPage(createAdminClient(), token);
  // A closed page (expired, replaced, voided) hands the client NOTHING about who or which scouts (qa-lead B10b #1): a
  // client component's props ride in the RSC payload whether or not it renders them.
  const view = state === 'open' ? page : null;
  const failed = (sp.failed ?? '')
    .split('.')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  return (
    <>
      <PageHeader kicker="Troop Meeting" title="Choose what you’ll teach" />
      <PageShell width="narrow">
        <TeachPageCard
          state={state}
          token={token}
          recipientName={view?.recipientName ?? ''}
          day={view?.meetingDate ? fmtDateFull(view.meetingDate) : ''}
          lines={view?.lines ?? []}
          err={sp.err ?? null}
          saved={sp.saved === '1'}
          failed={failed}
        />
      </PageShell>
    </>
  );
}
