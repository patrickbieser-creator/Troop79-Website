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
 */

import { useRef, useState, useTransition } from 'react';
import { SaveButton, SaveFeedback, useSavedSnapshot, useSavePhase } from '../../_components/save-state';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CalendarCategoryRow, CategoryTemplate } from '@/lib/calendar-categories';
import {
  MarkdownSplitPane,
  type MarkdownEditorHandle
} from '../../_components/markdown-split-pane';
import { useMarkdownBlockTools } from '../../_components/markdown-block-tools';
import { CalendarEntryForm, type CalendarEntryRow } from '../entry-form';
import styles from './workbench.module.css';
import { fmtDate, fmtRange } from '@/lib/format-date';

type ActionResult = { ok: boolean; error?: string };

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
  /** The signup layer, when one exists. */
  signupId: number | null;
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
  signupId,
  onSaveStory,
  onAddAgenda
}: Props) {
  const router = useRouter();
  const [story, setStory] = useState(entry.details_md ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Save standard (AGENTS.md "Save buttons", 2026-08-24): the story's Save is
  // off and reads "Saved" until the text differs from what is saved.
  const { dirty: storyDirty, markSaved: markStorySaved } = useSavedSnapshot(story);
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
      router.push(`/admin/advancement/meetings/${res.id}`);
    });
  }

  const dateLabel = entry.end_date ? fmtRange(entry.entry_date, entry.end_date) : fmtDate(entry.entry_date);

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
          <Link href={`/events/${entry.id}`} className={styles.btn}>
            View public page
          </Link>
        </div>
      </div>

      {err && <div className={styles.error}>{err}</div>}

      {/* ── the entry's own fields ──
          Editable here, not read-only. This panel is why "Edit" disappeared
          from the list: the workbench is the entry's editor, and having to
          leave it to fix a title was the whole complaint. */}
      <section className={styles.panel}>
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
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>Story</h2>
          <div>
            <SaveButton
              className={styles.primaryBtn}
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
      {template === 'meeting' && (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Agenda</h2>
            <div>
              {meeting ? (
                <Link href={`/admin/advancement/meetings/${meeting.id}`} className={styles.btn}>
                  Open agenda editor
                </Link>
              ) : (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={addAgenda}
                  disabled={isPending}
                >
                  {isPending ? 'Adding…' : 'Add an agenda'}
                </button>
              )}
            </div>
          </div>
          <p className={styles.panelNote}>
            {meeting
              ? `This meeting's agenda is ${meeting.status}. Roll Call lives on its own screen — taking attendance is a data-entry session, not editing.`
              : 'No agenda yet. Adding one makes this entry publish as a meeting.'}
          </p>
          {meeting && (
            <p className={styles.panelNote}>
              <Link href={`/admin/advancement/meetings/${meeting.id}/attendance`}>
                Take Roll Call &rarr;
              </Link>
            </p>
          )}
        </section>
      )}

      {/* ── attendance layer ──
          Every entry has one, not just meetings — that is the whole point of
          Roll Call. Its own route because taking attendance is a data-entry
          session, not editing. */}
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>Roll Call</h2>
          <div>
            <Link href={`/admin/calendar/${entry.id}/roll-call`} className={styles.btn}>
              Take Roll Call
            </Link>
          </div>
        </div>
        <p className={styles.panelNote}>
          Who was at this event. Seeded from the signup where there is one, and correctable by
          hand for anyone who told you verbally or turned up on the day.
        </p>
      </section>

      {/* ── signup layer ── */}
      <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Signup</h2>
            <div>
              {signupId ? (
                <Link href={`/admin/events/${signupId}`} className={styles.btn}>
                  Open signup builder
                </Link>
              ) : (
                <Link href="/admin/events" className={styles.btn}>
                  Enable a signup
                </Link>
              )}
            </div>
          </div>
          <p className={styles.panelNote}>
            {signupId
              ? 'Jobs, price tiers, capacity and questions for this entry.'
              : 'No signup on this entry. Not every event needs one — some you just come to.'}
          </p>
        {signupId && (
          <p className={styles.panelNote}>
            <Link href={`/admin/rosters/${signupId}`}>Event roster &rarr;</Link>
          </p>
        )}
      </section>
    </>
  );
}
