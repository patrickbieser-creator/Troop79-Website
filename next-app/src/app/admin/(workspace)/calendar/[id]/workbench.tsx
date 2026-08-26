'use client';

/**
 * The calendar entry workbench — one page per ENTRY, composing its layers.
 *
 * Entry-keyed on purpose: /admin/events/[id] is keyed by SIGNUP id, so an entry
 * with a story and no signup had no page at all, and `details_md` had no editor
 * anywhere in admin (it was reachable only by hand-writing SQL).
 *
 * The category's TEMPLATE decides which panels are offered and in what order.
 * It never decides which layers may exist — every panel here writes to its own
 * table, so an announcement that grows an agenda or a meeting that grows a
 * signup needs no conversion and no migration. Presentation adapts; the data
 * model does not.
 *
 * One TAB per layer (Patrick, 2026-08-24). The tabs are URL state now
 * (`?tab=`, 2026-08-25 — "the calendar page seems to be overloaded and is
 * getting much slower on prod"): the page loads ONLY the active tab's data,
 * and only that panel renders, instead of every layer's editor mounting
 * hidden on every visit (D-227's trade-off, retired). A tab click is a guarded
 * navigation — an unsaved Entry form gets the Discard-changes prompt rather
 * than vanishing. The Signup tab hosts the whole event workspace: the builder,
 * and via `?view=` the Roster / assignment sets / Money / Snapshot, so the
 * event tab strip never leaves the entry's head (Patrick: clicking Roster or
 * Snapshot "change[s] the screen, losing the top table").
 */

import { useState, useTransition, type ReactNode } from 'react';
import { Button } from '../../../_components/button';
import { PublicPageLink } from '../../../_components/public-page-link';
import { useRouter } from 'next/navigation';
import type { CalendarCategoryRow, CategoryTemplate } from '@/lib/calendar-categories';
import { TabStrip, type TabStripItem } from '../../_components/tab-strip';
import { BackNav } from '../../_components/back-nav';
import { useGuardedNav } from '../../_components/guarded-nav';
import { CalendarEntryForm, type CalendarEntryRow } from '../entry-form';
import { RollCall, type RollCallProps } from './roll-call/roll-call';
import { MeetingEditor, type MeetingEditorProps } from '../../advancement/meetings/[id]/meeting-editor';
import { BuilderPanels } from '../../events/[id]/builder-panels';
import { EventNav, type EventNavKey } from '../../rosters/[id]/event-nav';
import type { EventNavData } from '../../rosters/[id]/event-nav-data';
import type { BuilderData } from '../../events/[id]/load-builder';
import styles from './workbench.module.css';
import { fmtDate, fmtRange } from '@/lib/format-date';

type ActionResult = { ok: boolean; error?: string };

/** 'entry' absorbed Details + Story (2026-08-25) — one form, one save. */
export type WorkbenchTab = 'entry' | 'agenda' | 'roll-call' | 'signup';

export interface WorkbenchEntry {
  id: number;
  title: string;
  entry_date: string;
  end_date: string | null;
  category: string;
  categoryColor: string;
  location: string | null;
  description: string | null;
  details_md: string | null;
  on_calendar: boolean;
  show_on_homepage: boolean;
}

interface Props {
  entry: WorkbenchEntry;
  /** The full row, for the Entry panel's form. */
  row: CalendarEntryRow;
  categories: CalendarCategoryRow[];
  onSaveDetails: (fd: FormData) => Promise<ActionResult>;
  onCreateEntry: (fd: FormData) => Promise<ActionResult>;
  template: CategoryTemplate;
  /** The active tab — URL state, resolved by the page. */
  tab: WorkbenchTab;
  /** The agenda layer, when one exists. */
  meeting: { id: number; status: string } | null;
  /** The agenda editor's data and writes — loaded only when the Agenda tab is
   *  the active one; it renders INSIDE the tab (Patrick, 2026-08-24). */
  agenda: Omit<MeetingEditorProps, 'entry' | 'embedded'> | null;
  /** The signup layer, when one exists. */
  signupId: number | null;
  /** The builder's data — loaded only for the Signup tab's Builder view. */
  builder: BuilderData | null;
  /** The event tab strip's data, for any Signup view. */
  signupNav: EventNavData | null;
  /** A Signup view other than the builder (roster / assignments / money /
   *  snapshot), rendered on the server by the page and hosted here. */
  signupView: { key: EventNavKey; node: ReactNode } | null;
  /** People marked present so far — the Roll Call tab's count pill. */
  attendanceCount: number;
  /** The Roll Call sheet's data and writes — loaded only for its tab. Every
   *  checkbox saves on its own, so leaving the tab mid-roll loses nothing. */
  rollCall: Omit<RollCallProps, 'entryId' | 'entryTitle'> | null;
  onAddAgenda?: (fd: FormData) => Promise<{ ok: boolean; error?: string; id?: number }>;
  /** Enables a signup on this entry, in place (2026-08-25: the Calendar is
   *  the hub — no detour through the signups list to flip it on). */
  onEnableSignup?: (calendarEntryId: number) => Promise<{ ok: boolean; error?: string }>;
}

const TEMPLATE_NOTE: Record<CategoryTemplate, string> = {
  meeting: 'Agenda template — this entry publishes a meeting agenda.',
  activity: 'Activity template — story and signup.',
  announcement: 'Announcement template — story only.'
};

export function Workbench({
  entry,
  row,
  categories,
  onSaveDetails,
  onCreateEntry,
  template,
  tab,
  meeting,
  agenda,
  signupId,
  builder,
  signupNav,
  signupView,
  attendanceCount,
  rollCall,
  onAddAgenda,
  onEnableSignup
}: Props) {
  const router = useRouter();
  const { navigate, dialog } = useGuardedNav();
  const hasAgendaTab = template === 'meeting';
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function addAgenda() {
    if (!onAddAgenda) return;
    setErr(null);
    const fd = new FormData();
    fd.set('calendar_entry_id', String(entry.id));
    fd.set('title', entry.title);
    startTransition(async () => {
      const res = await onAddAgenda(fd);
      if (!res.ok || !res.id) {
        setErr(res.error ?? 'Could not add the agenda.');
        return;
      }
      // The editor renders in this tab once the page re-reads the layer.
      router.refresh();
    });
  }

  function enableSignupHere() {
    if (!onEnableSignup) return;
    setErr(null);
    startTransition(async () => {
      const res = await onEnableSignup(entry.id);
      if (!res.ok) {
        setErr(res.error ?? 'Could not enable the signup.');
        return;
      }
      // The builder renders in this tab once the page re-reads the layer.
      router.refresh();
    });
  }

  const dateLabel = entry.end_date ? fmtRange(entry.entry_date, entry.end_date) : fmtDate(entry.entry_date);
  const tabHref = (key: WorkbenchTab) => `/admin/calendar/${entry.id}?tab=${key}`;
  const go = (key: WorkbenchTab) => () => {
    if (key !== tab) navigate(tabHref(key));
  };

  const tabs: TabStripItem[] = [
    { key: 'entry', label: 'Entry', onSelect: go('entry') },
    ...(hasAgendaTab ? [{ key: 'agenda', label: 'Agenda', onSelect: go('agenda') }] : []),
    // Signup before Roll Call (Patrick, 2026-08-25): you build the signup
    // weeks ahead; roll call is the day-of step.
    { key: 'signup', label: 'Signup', onSelect: go('signup') },
    {
      key: 'roll-call',
      label: 'Roll Call',
      count: attendanceCount > 0 ? attendanceCount : undefined,
      onSelect: go('roll-call')
    }
  ];

  return (
    <>
      <div className={styles.head}>
        <div>
          <BackNav back={{ label: 'Calendar', href: '/admin/calendar' }} current={entry.title} />
          <h1>{entry.title}</h1>
          <p className={styles.headMeta}>
            {/* inline: dynamic — per-category color from the lookup table */}
            <span className={styles.cat} style={{ background: entry.categoryColor }}>
              {entry.category}
            </span>
            <span>{dateLabel}</span>
            {entry.location && <span>{entry.location}</span>}
            {!entry.on_calendar && <span className={styles.flag}>Off calendar</span>}
            {entry.show_on_homepage && <span className={styles.flag}>Promoted</span>}
          </p>
          <p className={styles.templateNote}>{TEMPLATE_NOTE[template]}</p>
        </div>
        <div className={styles.headActions}>
          <PublicPageLink href={`/events/${entry.id}`} />
        </div>
      </div>

      {err && <div className={styles.error}>{err}</div>}

      <TabStrip ariaLabel="Entry layers" activeKey={tab} items={tabs} className={styles.tabs} />
      {dialog}

      {/* ── the entry: its own fields AND the story, one form ──
          Editable here, not read-only. This panel is why "Edit" disappeared
          from the list: the workbench is the entry's editor. The Story used to
          be its own tab with its own Save (Patrick, 2026-08-25: "consolidate
          Details and story" on the news editor's pattern). */}
      {tab === 'entry' && (
        <section className={styles.panel} role="tabpanel" aria-label="Entry">
          <CalendarEntryForm
            row={row}
            variant="inline"
            categories={categories}
            onCreate={onCreateEntry}
            onUpdate={onSaveDetails}
            onClose={() => {}}
          />
        </section>
      )}

      {/* ── agenda layer (meeting template, leaders only) ── */}
      {tab === 'agenda' && hasAgendaTab && (
        <section className={styles.panel} role="tabpanel" aria-label="Agenda">
          {/* The editor itself lives here (Patrick, 2026-08-24) — its own
              header (status, Publish, Delete agenda) sits under this one. */}
          {meeting && agenda ? (
            <MeetingEditor {...agenda} entry={{ id: entry.id, entry_date: entry.entry_date }} embedded />
          ) : (
            <>
              <div className={styles.panelHead}>
                <h2>Agenda</h2>
                <div>
                  <Button variant="primary" onClick={addAgenda} disabled={isPending}>
                    {isPending ? 'Adding…' : 'Add an agenda'}
                  </Button>
                </div>
              </div>
              <p className={styles.panelNote}>
                No agenda yet. Adding one makes this entry publish as a meeting.
              </p>
            </>
          )}
        </section>
      )}

      {/* ── attendance layer ──
          Every entry has one, not just meetings — that is the whole point of
          Roll Call. The sheet renders right here (Patrick, 2026-08-24); its
          Scouts / Leaders / Adults strip is a SUB-tab bar under this one. */}
      {tab === 'roll-call' && rollCall && (
        <section className={styles.panel} role="tabpanel" aria-label="Roll Call">
          <div className={styles.panelHead}>
            <h2>Roll Call</h2>
          </div>
          <p className={styles.panelNote}>
            Who was at this event. Seeded from the signup where there is one, and correctable by
            hand for anyone who told you verbally or turned up on the day. Every check saves as you go.
          </p>
          <RollCall entryId={entry.id} entryTitle={entry.title} {...rollCall} />
        </section>
      )}

      {/* ── signup layer ──
          The whole event workspace lives in this tab: the builder, and via
          the event tab strip the Roster, each assignment set, Money and the
          Snapshot — every one of them rendered HERE (2026-08-25), so the
          entry's head and layer tabs stay put. Before a signup exists the tab
          offers to enable one. */}
      {tab === 'signup' && (
        <section className={styles.panel} role="tabpanel" aria-label="Signup">
          {signupId && signupNav ? (
            <>
              <EventNav
                signupId={signupId}
                entryId={entry.id}
                active={signupView?.key ?? 'builder'}
                sets={signupNav.sets}
                hasMoney={signupNav.hasMoney}
                inWorkbench
              />
              {signupView ? (
                signupView.node
              ) : builder && builder.entry ? (
                <BuilderPanels
                  signupId={signupId}
                  calendarEntryId={entry.id}
                  entryDate={entry.entry_date}
                  endDate={entry.end_date}
                  signup={builder.signup}
                  prices={builder.prices}
                  slots={builder.slots}
                  questions={builder.questions}
                  sets={builder.sets}
                  category={entry.category}
                  templates={builder.templates}
                  previewCtx={builder.previewCtx}
                />
              ) : null}
            </>
          ) : (
            <>
              <div className={styles.panelHead}>
                <h2>Signup</h2>
                <div>
                  <Button type="button" onClick={enableSignupHere} disabled={isPending || !onEnableSignup}>
                    Enable a signup
                  </Button>
                </div>
              </div>
              <p className={styles.panelNote}>
                No signup on this entry. Not every event needs one — some you just come to.
              </p>
            </>
          )}
        </section>
      )}
    </>
  );
}
