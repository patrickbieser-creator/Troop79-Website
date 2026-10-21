/**
 * /i/<token>: a meeting invite's answer page (Plans/Matcher-Tune-Up.md T-5, P1 teachers). The GET only reads
 * (inspectInvite writes nothing, so a mail scanner's prefetch can't spend the link); the answer is a POST
 * (answerInviteAction). No sign-in: the link answers its one invite and nothing else. Headers (no-referrer, no-store,
 * noindex) are set for /i/* in next.config.ts.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { fmtDateFull } from '@/lib/format-date';
import { minutesText, topicWords } from '@/lib/meeting-board-picklist';
import { inspectInvite } from '@/lib/meeting-invites-db';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { InviteCard } from './invite-card';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Meeting Invite — Scout Troop 79',
  robots: { index: false, follow: false }
};

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ err?: string }> }) {
  const [{ token }, { err }] = await Promise.all([params, searchParams]);
  const { state, invite } = await inspectInvite(createAdminClient(), token);
  const catalog = invite ? await loadAdvancementCatalog() : null;
  const words = invite && catalog ? topicWords(invite.topicKey, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, undefined, { mbReqs: catalog.meritBadgeRequirements }) : null;

  return (
    <>
      <PageHeader kicker="Troop Meeting" title="Meeting Invite" />
      <PageShell width="narrow">
        <InviteCard
          state={state}
          kind={invite?.kind ?? 'teach'}
          token={token}
          inviteeId={invite?.inviteeId ?? 0}
          inviteeName={invite?.inviteeName ?? ''}
          recipientName={invite?.recipientName ?? ''}
          recipientIsInvitee={invite?.recipientIsInvitee ?? true}
          topic={words?.label ?? invite?.topicKey ?? ''}
          code={words?.codeLabel ?? ''}
          minutes={minutesText(words?.minutes)}
          parts={words?.parts ?? []}
          day={invite?.meetingDate ? fmtDateFull(invite.meetingDate) : ''}
          response={invite?.response ?? null}
          err={err ?? null}
        />
      </PageShell>
    </>
  );
}
