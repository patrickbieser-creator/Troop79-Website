/**
 * /planner — the Meeting Planner (Plans/Meeting-Planner-II.md). Reached from the account menu under the signed-in
 * name ("Meeting Planner"), for anyone holding meeting_planner.view, .edit or .seed (granted one person at a time).
 *
 * The This Sunday board for the next meeting (board-view.tsx): read-only for a viewer; an editor (P2a) also opens a
 * person's drawer, assigns, adds offers. Signed out → sign in and come back; signed in without a planner right → a
 * plain "no access" message.
 */
import { redirect } from "next/navigation";
import { resolveAdminActor } from "@/lib/admin-actor";
import { createAdminClient } from "@/lib/supabase/server";
import { fmtDay } from "@/lib/format-date";
import { plannerAccess } from "@/lib/meeting-planner-access";
import { loadPlannerPage } from "@/lib/meeting-planner-load";
import { PageHeader } from "@/app/_components/page-header";
import { PageShell } from "@/app/_components/page-shell";
import { Notice } from "@/app/_components/notice";
import { PlannerBoardView } from "./board-view";
import { PlannerPoller } from "./planner-poller";
import { PlannerProvider } from "./planner-client";
import styles from "./planner.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Meeting Planner — Scout Troop 79",
};

export default async function PlannerPage() {
  const actor = await resolveAdminActor();
  if (!actor) redirect("/signin?next=/planner");
  const access = plannerAccess(actor);
  if (!access.canView) {
    return (
      <>
        <PageHeader kicker="Members" title="Meeting Planner" />
        <PageShell width="narrow">
          <Notice tone="info">
            You don’t have access to the Meeting Planner. A troop leader can
            give it to you.
          </Notice>
        </PageShell>
      </>
    );
  }

  const page = await loadPlannerPage(createAdminClient());
  if (!page) {
    return (
      <>
        <PageHeader kicker="Meeting Planner" title="No meeting coming up" />
        <PageShell width="narrow">
          <Notice tone="info">
            There’s no troop meeting on the calendar yet. The board opens once
            one is published.
          </Notice>
        </PageShell>
      </>
    );
  }

  const heading = (
    <div>
      <p className={styles.kicker}>Meeting Planner</p>
      <h1 className={styles.title}>
        {page.meeting.dateLabel} · {page.meeting.title}
      </h1>
      <p className={styles.sub}>
        Sign-ups close at 5:30 pm on {fmtDay(page.meeting.date)} ·{" "}
        <PlannerPoller entryId={page.meeting.entryId} stamp={page.stamp} />
      </p>
    </div>
  );
  const e = page.board.everyone.adults;
  const adults = [...e.coming, ...e.undecided, ...e.noAnswer]
    .map((t) => ({ personId: t.personId, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <PlannerProvider
      entryId={page.meeting.entryId}
      canEdit={access.canEdit}
      adults={adults}
      stamp={page.stamp}
    >
      <div className={styles.page}>
        {page.meeting.mode === "closed" ? (
          <>
            <header className={styles.head}>{heading}</header>
            <div className={styles.noticeWrap}>
              <Notice tone="info">No sign-ups this week.</Notice>
            </div>
          </>
        ) : (
          <PlannerBoardView board={page.board} heading={heading} />
        )}
      </div>
    </PlannerProvider>
  );
}
