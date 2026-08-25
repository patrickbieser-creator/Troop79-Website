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
 * One TAB per layer (Patrick, 2026-08-24: "introduce that same tab format we
 * have used elsewhere … so at the top of the form it's evident what options
 * are available"). The panels used to stack down the page, so the agenda and
 * roll-call options sat below a full entry form and a markdown editor. The
 * shared pill TabStrip is the strip; every panel stays MOUNTED and is hidden
 * with the `hidden` attribute rather than unmounted, so a half-written story
 * or an edited-but-unsaved Details form survives a look at another tab. This
 * is the "tabbed workbench" pattern on /admin/styleguide/admin → Tab Strips.
 */

import { useRef, useState, useTransition } from 'react';
import { DiscardButton, SaveButton, SaveFeedback, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import { Button } from '../../../_components/button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CalendarCategoryRow, CategoryTemplate } from '@/lib/calendar-categories';
import {
  MarkdownSplitPane,
  type MarkdownEditorHandle
} from '../../_components/markdown-split-pane';
import { useMarkdownBlockTools } from '../../_components/markdown-block-tools';
import { TabStrip, type TabStripItem } from '../../_components/tab-strip';
import { CalendarEntryForm, type CalendarEntryRow } from '../entry-form';
import { RollCall, type RollCallProps } from './roll-call/roll-call';
import { MeetingEditor, type MeetingEditorProps } from '../../advancement/meetings/[id]/meeting-editor';
import { BuilderPanels } from '../../events/[id]/builder-panels';
import { EventNav } from '../../rosters/[id]/event-nav';
import type { BuilderData } from '../../events/[id]/load-builder';
import styles from './workbench.module.css';
import { fmtDate, fmtRange } from '@/lib/format-date';

type ActionResult = { ok: boolean; error?: string };

export type WorkbenchTab = 'details' | 'story' | 'agenda' | 'roll-call' | 'signup';

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
  /** The full row, for the Details panel's form. */
  row: CalendarEntryRow;
  categories: CalendarCategoryRow[];
  onSaveDetails: (fd: FormData) => Promise<ActionResult>;
  onCreateEntry: (fd: FormData) => Promise<ActionResult>;
  template: CategoryTemplate;
  /** The agenda layer, when one exists. */
  meeting: { id: number; status: string } | null;
  /** The agenda editor's data and writes, when the layer exists — it renders
   *  INSIDE the Agenda tab (Patrick, 2026-08-24). */
  agenda: Omit<MeetingEditorProps, 'entry' | 'embedded'> | null;
  /** The signup layer, when one exists. */
  signupId: number | null;
  /** The signup builder's data, when the layer exists — the builder renders
   *  INSIDE the Signup tab (Patrick, 2026-08-24). */
  builder: BuilderData | null;
  /** People marked present so far — the Roll Call tab's count pill. */
  attendanceCount: number;
  /** The Roll Call sheet's data and writes — it renders INSIDE the tab
   *  (Patrick, 2026-08-24: "display the take roll editor right away"). Every
   *  checkbox saves on its own, so leaving the tab mid-roll loses nothing. */
  rollCall: Omit<RollCallProps, 'entryId' | 'entryTitle'>;
  /** Which tab opens first — deep links from the layer screens' back links. */
  initialTab?: WorkbenchTab;
  onSaveStory: (fd: FormData) => Promise<ActionResult>;
  onAddAgenda?: (fd: FormData) => Promise<{ ok: boolean; error?: string; id?: number }>;
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
  meeting,
  agenda,
  signupId,
  builder,
  attendanceCount,
  rollCall,
  initialTab,
  onSaveStory,
  onAddAgenda
}: Props) {
  const router = useRouter();
  const hasAgendaTab = template === 'meeting';
  const [tab, setTab] = useState<WorkbenchTab>(() =>
    initialTab && (initialTab !== 'agenda' || hasAgendaTab) ? initialTab : 'details'
  );
  const [story, setStory] = useState(entry.details_md ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Save standard (AGENTS.md "Save buttons", 2026-08-24): the story's Save is
  // off and reads "Saved" until the text differs from what is saved.
  const { dirty: storyDirty, markSaved: markStorySaved, saved: savedStory } = useDraftSnapshot(story);
  const storyFeedback = useSavePhase();
  // D-081's promise was that `details_md` gets the NEWS EDITOR's experience,
  // not merely a textarea with a preview — so the story panel takes the same
  // insert toolbar, inline prompts and click-to-edit blocks the article
  // editor has, from the same shared hook.
  const storyRef = useRef<MarkdownEditorHandle>(null);
  const blockTools = useMarkdownBlockTools(storyRef);

  function saveStory() {
    setErr(null);
    const fd = new FormData();
    fd.set('id', String(entry.id));
    fd.set('details_md', story);
    storyFeedback.start();
    startTransition(async () => {
      const res = await onSaveStory(fd);
      if (!res.ok) {
        storyFeedback.fail();
        setErr(res.error ?? 'Could not save the story.');
        return;
      }
      markStorySaved();
      storyFeedback.done();
    });
  }

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

  const dateLabel = entry.end_date ? fmtRange(entry.entry_date, entry.end_date) : fmtDate(entry.entry_date);

  // A dot on the Story tab says "unsaved draft here" while you look elsewhere.
  const tabs: TabStripItem[] = [
    { key: 'details', label: 'Details', onSelect: () => setTab('details') },
    { key: 'story', label: storyDirty ? 'Story •' : 'Story', onSelect: () => setTab('story') },
    ...(hasAgendaTab ? [{ key: 'agenda', label: 'Agenda', onSelect: () => setTab('agenda') }] : []),
    {
      key: 'roll-call',
      label: 'Roll Call',
      count: attendanceCount > 0 ? attendanceCount : undefined,
      onSelect: () => setTab('roll-call')
    },
    { key: 'signup', label: 'Signup', onSelect: () => setTab('signup') }
  ];

  return (
    <>
      <div className={styles.head}>
        <div>
          <Link href="/admin/calendar" className={styles.backLink}>
            &larr; All calendar entries
          </Link>
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
          <Button href={`/events/${entry.id}`}>
            View public page
          </Button>
        </div>
      </div>

      {err && <div className={styles.error}>{err}</div>}

      <TabStrip ariaLabel="Entry layers" activeKey={tab} items={tabs} className={styles.tabs} />

      {/* ── the entry's own fields ──
          Editable here, not read-only. This panel is why "Edit" disappeared
          from the list: the workbench is the entry's editor, and having to
          leave it to fix a title was the whole complaint. */}
      <section className={styles.panel} role="tabpanel" aria-label="Details" hidden={tab !== 'details'}>
        <div className={styles.panelHead}>
          <h2>Details</h2>
        </div>
        <CalendarEntryForm
          row={row}
          variant="inline"
          categories={categories}
          onCreate={onCreateEntry}
          onUpdate={onSaveDetails}
          onClose={() => {}}
        />
      </section>

      {/* ── story layer ── */}
      <section className={styles.panel} role="tabpanel" aria-label="Story" hidden={tab !== 'story'}>
        <div className={styles.panelHead}>
          <h2>Story</h2>
          <div>
            <DiscardButton dirty={storyDirty} pending={isPending} onClick={() => setStory(savedStory)} />
            <SaveButton
              dirty={storyDirty}
              pending={isPending}
              dirtyLabel="Save story"
              onClick={saveStory}
            />
            <SaveFeedback phase={storyFeedback.phase} />
          </div>
        </div>
        <p className={styles.panelNote}>
          The full write-up families read on the event page. Leave it empty when the calendar line
          says everything — the rule of thumb is whether a family has to DECIDE something.
        </p>
        <MarkdownSplitPane
          ref={storyRef}
          value={story}
          onChange={setStory}
          label="Story"
          cheatSheet
          toolbar={blockTools.toolbar}
          onEditBlock={blockTools.onEditBlock}
          placeholder="What is this, who is it for, what should families bring or decide?"
        >
          {blockTools.prompts}
        </MarkdownSplitPane>
        {blockTools.pickers}
      </section>

      {/* ── agenda layer (meeting template, leaders only) ── */}
      {hasAgendaTab && (
        <section className={styles.panel} role="tabpanel" aria-label="Agenda" hidden={tab !== 'agenda'}>
          {/* The editor itself lives here (Patrick, 2026-08-24) — its own
              header (status, Publish, Delete agenda) sits under this one. */}
          {meeting && agenda ? (
            <MeetingEditor {...agenda} entry={{ id: entry.id, entry_date: entry.entry_date }} embedded />
          ) : (
            <>
              <div className={styles.panelHead}>
                <h2>Agenda</h2>
                <div>
                  <Button
                    variant="primary"
                    onClick={addAgenda}
                    disabled={isPending}
                  >
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
          Scouts / Leaders / Adults strip is a SUB-tab bar under this one, so
          the layer tabs stay put while you work down a list. Each checkbox
          saves on its own — nothing is lost by switching tabs mid-roll. */}
      <section className={styles.panel} role="tabpanel" aria-label="Roll Call" hidden={tab !== 'roll-call'}>
        <div className={styles.panelHead}>
          <h2>Roll Call</h2>
        </div>
        <p className={styles.panelNote}>
          Who was at this event. Seeded from the signup where there is one, and correctable by
          hand for anyone who told you verbally or turned up on the day. Every check saves as you go.
        </p>
        <RollCall entryId={entry.id} entryTitle={entry.title} {...rollCall} />
      </section>

      {/* ── signup layer ──
          The builder itself renders here once a signup exists (Patrick,
          2026-08-24); before that the tab offers to enable one. EventNav
          keeps Roster / Money / Assignments one click away. */}
      <section className={styles.panel} role="tabpanel" aria-label="Signup" hidden={tab !== 'signup'}>
        {signupId && builder && builder.entry ? (
          <>
            <EventNav signupId={signupId} entryId={entry.id} active="builder" sets={builder.nav.sets} hasMoney={builder.nav.hasMoney} />
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
            />
          </>
        ) : (
          <>
            <div className={styles.panelHead}>
              <h2>Signup</h2>
              <div>
                <Button href="/admin/events">
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
    </>
  );
}
