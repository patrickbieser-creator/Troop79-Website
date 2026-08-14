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

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CategoryTemplate } from '@/lib/calendar-categories';
import { MarkdownSplitPane } from '../../_components/markdown-split-pane';
import styles from './workbench.module.css';

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
  template: CategoryTemplate;
  /** The agenda layer, when one exists. */
  meeting: { id: number; status: string } | null;
  /** The signup layer, when one exists. */
  signupId: number | null;
  /** Leader-only panels are omitted entirely for a scout session — the server
   *  decides this, the client only renders what it was handed. */
  canManageAgenda: boolean;
  onSaveStory: (fd: FormData) => Promise<ActionResult>;
  /** Omitted for scout sessions — the panel that uses it is not rendered. */
  onAddAgenda?: (fd: FormData) => Promise<{ ok: boolean; error?: string; id?: number }>;
}

const TEMPLATE_NOTE: Record<CategoryTemplate, string> = {
  meeting: 'Agenda template — this entry publishes a meeting agenda.',
  activity: 'Activity template — story and signup.',
  announcement: 'Announcement template — story only.'
};

export function Workbench({
  entry,
  template,
  meeting,
  signupId,
  canManageAgenda,
  onSaveStory,
  onAddAgenda
}: Props) {
  const router = useRouter();
  const [story, setStory] = useState(entry.details_md ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function saveStory() {
    setErr(null);
    setSaved(false);
    const fd = new FormData();
    fd.set('id', String(entry.id));
    fd.set('details_md', story);
    startTransition(async () => {
      const res = await onSaveStory(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Could not save the story.');
        return;
      }
      setSaved(true);
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

  const dateLabel = entry.end_date ? `${entry.entry_date} – ${entry.end_date}` : entry.entry_date;

  return (
    <>
      <div className={styles.head}>
        <div>
          <Link href="/admin/calendar" className={styles.backLink}>
            &larr; All calendar entries
          </Link>
          <h1>{entry.title}</h1>
          <p className={styles.headMeta}>
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

      {/* ── story layer ── */}
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>Story</h2>
          <div>
            {saved && <span className={styles.savedNote}>Saved</span>}
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={saveStory}
              disabled={isPending}
            >
              {isPending ? 'Saving…' : 'Save story'}
            </button>
          </div>
        </div>
        <p className={styles.panelNote}>
          The full write-up families read on the event page. Leave it empty when the calendar line
          says everything — the rule of thumb is whether a family has to DECIDE something.
        </p>
        <MarkdownSplitPane
          value={story}
          onChange={(v) => {
            setStory(v);
            setSaved(false);
          }}
          label="Story"
          placeholder="What is this, who is it for, what should families bring or decide?"
        />
      </section>

      {/* ── agenda layer (meeting template, leaders only) ── */}
      {template === 'meeting' && canManageAgenda && (
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

      {/* ── signup layer ── */}
      {canManageAgenda && (
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
      )}
    </>
  );
}
