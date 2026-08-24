'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import type { Meeting, MeetingSection, MeetingSession } from '@/lib/supabase/types';
import { fmtDateFull } from '@/lib/format-date';
import type { PromotePayload } from '../actions';
import styles from '../meetings.module.css';
import { Badge } from '../../../_components/badge';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../../../_components/dialog';
import { Notice } from '../../../_components/notice';
import { DiscardButton, SaveButton, SaveFeedback, useFormDirty, useSavePhase } from '../../../_components/save-state';

type ActionResult = { ok: boolean; error?: string };

/** One Meeting Plan engine suggestion, flattened for the tray. */
export interface Candidate {
  key: number;
  codeLabel: string;
  reqLabel: string;
  eagle: boolean;
  track: string;
  skillId: string | null;
  skillName: string | null;
  leaderName: string | null;
  scouts: string[];
  groupPart: string | null;
}

interface Props {
  meeting: Meeting;
  /** The calendar entry this meeting is the agenda layer of. The entry owns the
   *  date and the public URL — the agenda no longer carries either. */
  entry: { id: number; entry_date: string };
  sessions: MeetingSession[];
  /** null = engine unavailable (load error) — tray shows a quiet note. */
  candidates: Candidate[] | null;
  onUpdateMeeting: (fd: FormData) => Promise<ActionResult>;
  onSetStatus: (id: number, status: 'draft' | 'published') => Promise<ActionResult>;
  onCreateSession: (fd: FormData) => Promise<ActionResult>;
  onUpdateSession: (fd: FormData) => Promise<ActionResult>;
  onDeleteSession: (id: number, meetingId: number) => Promise<ActionResult>;
  onMoveSession: (id: number, meetingId: number, direction: 'up' | 'down') => Promise<ActionResult>;
  onPromote: (payload: PromotePayload) => Promise<ActionResult>;
}

export function MeetingEditor({
  meeting,
  entry,
  sessions,
  candidates,
  onUpdateMeeting,
  onSetStatus,
  onCreateSession,
  onUpdateSession,
  onDeleteSession,
  onMoveSession,
  onPromote
}: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [openFor, setOpenFor] = useState<MeetingSession | { newIn: MeetingSection } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [addedKeys, setAddedKeys] = useState<Set<number>>(new Set());
  const dialogRef = useRef<HTMLDialogElement>(null);
  /** The logistics form, so Publish can commit it before flipping status. */
  const formRef = useRef<HTMLFormElement>(null);
  const [, startTransition] = useTransition();
  // Save standard (2026-08-24): the logistics form is uncontrolled, so its
  // FormData is the draft; Saving… → Done on the panel.
  const logistics = useFormDirty(formRef);
  const feedback = useSavePhase();

  const preMeeting = sessions.filter((s) => s.section === 'pre_meeting');
  const agenda = sessions.filter((s) => s.section === 'agenda');
  const published = meeting.status === 'published';

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (openFor && !dlg.open) dlg.showModal();
    if (!openFor && dlg.open) dlg.close();
  }, [openFor]);

  function run(key: string, fn: () => Promise<ActionResult>, after?: () => void) {
    setErr(null);
    setSavedNote(false);
    setBusyKey(key);
    startTransition(async () => {
      const res = await fn();
      setBusyKey(null);
      if (!res.ok) {
        setErr(res.error ?? 'Something went wrong.');
        return;
      }
      after?.();
    });
  }

  function saveLogistics(form: HTMLFormElement) {
    const fd = new FormData(form);
    fd.set('id', String(meeting.id));
    feedback.start();
    run(
      'logistics',
      async () => {
        const res = await onUpdateMeeting(fd);
        if (!res.ok) feedback.fail();
        return res;
      },
      () => {
        logistics.markSaved();
        feedback.done();
        setSavedNote(true);
      }
    );
  }

  /**
   * Publish/unpublish COMMITS THE LOGISTICS FORM FIRST.
   *
   * This button lives in the header, outside the logistics <form>, and used to
   * call onSetStatus alone. So editing a field there and hitting Publish —
   * rather than the "Save logistics" button buried in the panel title — flipped
   * the status and silently threw the edit away. Reported against the date:
   * "I put the date in as August 16th, but it reverted to August 9th. I added
   * another meeting for August 23rd and it also reverted." Every other
   * logistics field lost edits the same way; the date was just the one visible
   * enough to notice, because the page heading kept showing the stored value.
   *
   * Saving unconditionally rather than tracking a dirty flag: the write is
   * idempotent, this is a handful of leaders on a small admin tool, and
   * "publishing shows you what you were looking at" is the behaviour that
   * needs no explaining.
   */
  function togglePublish() {
    const next = published ? 'draft' : 'published';
    if (
      next === 'published' &&
      agenda.length === 0 &&
      !window.confirm('The agenda is empty — publish anyway?')
    ) {
      return;
    }
    const form = formRef.current;
    setErr(null);
    setSavedNote(false);
    setBusyKey('publish');
    startTransition(async () => {
      if (form) {
        const fd = new FormData(form);
        fd.set('id', String(meeting.id));
        const saved = await onUpdateMeeting(fd);
        if (!saved.ok) {
          setBusyKey(null);
          // Surfaced rather than swallowed: a date collision with another
          // meeting reports here, and publishing must not proceed on details
          // that were rejected.
          setErr(saved.error ?? 'Could not save the meeting details.');
          return;
        }
      }
      const res = await onSetStatus(meeting.id, next);
      setBusyKey(null);
      if (!res.ok) setErr(res.error ?? 'Something went wrong.');
    });
  }

  function removeSession(s: MeetingSession) {
    if (!window.confirm(`Remove "${s.title}" from the ${s.section === 'pre_meeting' ? 'pre-meeting list' : 'agenda'}?`)) return;
    run(`del-${s.id}`, () => onDeleteSession(s.id, meeting.id));
  }

  function promote(c: Candidate) {
    const payload: PromotePayload = {
      meetingId: meeting.id,
      title: c.skillName ? `${c.skillName}: ${c.codeLabel}` : c.codeLabel,
      description: c.reqLabel + (c.groupPart ? ` (Group ${c.groupPart})` : ''),
      track: c.track,
      leaderName: c.leaderName,
      skillId: c.skillId,
      requirements: [{ code: c.codeLabel, label: c.reqLabel }],
      scouts: c.scouts.length ? c.scouts : null
    };
    run(`promote-${c.key}`, () => onPromote(payload), () => {
      setAddedKeys((prev) => new Set(prev).add(c.key));
    });
  }

  return (
    <>
      <div className={styles.editorHead}>
        <div>
          <Link href="/admin/advancement/meetings" className={styles.backLink}>
            &larr; All meetings
          </Link>
          <h1>
            {meeting.title} &mdash; {fmtDateFull(entry.entry_date)}
          </h1>
        </div>
        <div className={styles.headActions}>
          <Badge variant={published ? 'success' : 'neutral'}>{meeting.status}</Badge>
          {published && (
            <Link href={`/events/${entry.id}`} className={styles.editBtn}>
              View public page
            </Link>
          )}
          <button
            type="button"
            className={published ? styles.unpublishBtn : styles.publishBtn}
            onClick={togglePublish}
            disabled={busyKey === 'publish'}
          >
            {busyKey === 'publish' ? '…' : published ? 'Unpublish' : 'Publish'}
          </button>
        </div>
      </div>

      {err && <Notice>{err}</Notice>}

      <div className={styles.editorGrid}>
        <div>
          {/* ── logistics ── */}
          <form
            ref={formRef}
            className={styles.panel}
            onSubmit={(e) => {
              e.preventDefault();
              saveLogistics(e.currentTarget);
            }}
          >
            <div className={styles.panelTitle}>
              <span>Logistics</span>
              <DiscardButton dirty={logistics.dirty} pending={busyKey === 'logistics'} onClick={logistics.reset} />
              <SaveButton
                type="submit"
                className={styles.editBtn}
                dirty={logistics.dirty}
                pending={busyKey === 'logistics'}
                dirtyLabel="Save logistics"
              />
              <SaveFeedback phase={feedback.phase} />
            </div>
            <div className={styles.logisticsGrid}>
              {/* The date belongs to the calendar entry now. Editing it from
                  the agenda layer is precisely how the two used to drift out of
                  step, so this is a read-only reference with a way over to the
                  entry that owns it. */}
              <label className={styles.editField}>
                <span className={styles.editLabel}>Date</span>
                <span className={styles.readOnlyValue}>
                  {fmtDateFull(entry.entry_date)}{' '}
                  <Link href={`/admin/calendar/${entry.id}`}>Change on the calendar entry</Link>
                </span>
              </label>
              <Field label="Title" name="title" defaultValue={meeting.title} />
              <Field label="Time" name="time_range" defaultValue={meeting.time_range ?? ''} placeholder="4:00 – 5:30 PM" />
              <Field label="Uniform" name="uniform" defaultValue={meeting.uniform ?? ''} placeholder="Class A" />
              <Field label="Location" name="location" defaultValue={meeting.location ?? ''} />
              <Field
                label="Address"
                name="location_address"
                defaultValue={meeting.location_address ?? ''}
              />
              <Field label="Snack" name="snack" defaultValue={meeting.snack ?? ''} />
              <Field label="Flag Ceremony" name="flag_ceremony" defaultValue={meeting.flag_ceremony ?? ''} placeholder="Patrol name" />
              <Field label="Cleanup" name="cleanup" defaultValue={meeting.cleanup ?? ''} placeholder="Patrol name" />
              <Field label="Duty Roster URL" name="duty_roster_url" defaultValue={meeting.duty_roster_url ?? ''} />
            </div>
            {savedNote && <div className={styles.okNote}>Logistics saved.</div>}
          </form>

          {/* ── pre-meeting ── */}
          <SessionPanel
            title="Before the Meeting"
            emptyNote="Nothing scheduled before the meeting."
            rows={preMeeting}
            meetingId={meeting.id}
            busyKey={busyKey}
            onAdd={() => setOpenFor({ newIn: 'pre_meeting' })}
            onEdit={setOpenFor}
            onDelete={removeSession}
            onMove={(s, dir) => run(`move-${s.id}`, () => onMoveSession(s.id, meeting.id, dir))}
          />

          {/* ── agenda ── */}
          <SessionPanel
            title="Agenda"
            emptyNote="No agenda items yet — add one, or promote a suggestion from the plan."
            rows={agenda}
            meetingId={meeting.id}
            busyKey={busyKey}
            onAdd={() => setOpenFor({ newIn: 'agenda' })}
            onEdit={setOpenFor}
            onDelete={removeSession}
            onMove={(s, dir) => run(`move-${s.id}`, () => onMoveSession(s.id, meeting.id, dir))}
          />
        </div>

        {/* ── candidate tray ── */}
        <aside className={styles.tray}>
          <div className={styles.panel}>
            <div className={styles.panelTitle}>
              <span>Plan Suggestions</span>
            </div>
            <p className={styles.trayNote}>
              The Meeting Plan engine&rsquo;s suggestions for {fmtDateFull(entry.entry_date)}.
              Promoting copies one into the agenda as an editable item &mdash; the plan itself is
              never changed.
            </p>
            {candidates === null ? (
              <p className={styles.trayNote}>
                Suggestions unavailable right now (engine data failed to load). You can still build
                the agenda by hand.
              </p>
            ) : candidates.length === 0 ? (
              <p className={styles.trayNote}>No suggestions for this date.</p>
            ) : (
              candidates.map((c) => (
                <div key={c.key} className={styles.candidateCard}>
                  <div className={styles.candidateCode}>
                    {c.track}
                    {c.eagle && <span className={styles.eagleTag}> · Eagle</span>}
                    {c.groupPart && <> · Group {c.groupPart}</>}
                  </div>
                  <div className={styles.candidateTitle}>
                    {c.skillName ? `${c.skillName}: ${c.codeLabel}` : c.codeLabel}
                  </div>
                  <div className={styles.candidateMeta}>
                    {c.reqLabel}
                    {c.leaderName && (
                      <>
                        <br />
                        Teacher: {c.leaderName}
                      </>
                    )}
                    {c.scouts.length > 0 && (
                      <>
                        <br />
                        {c.scouts.length} scout{c.scouts.length === 1 ? '' : 's'}: {c.scouts.join(', ')}
                      </>
                    )}
                  </div>
                  <div className={styles.candidateFoot}>
                    {addedKeys.has(c.key) ? (
                      <span className={styles.candidateAdded}>Added ✓</span>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      className={styles.editBtn}
                      onClick={() => promote(c)}
                      disabled={busyKey === `promote-${c.key}`}
                    >
                      {busyKey === `promote-${c.key}` ? 'Adding…' : addedKeys.has(c.key) ? 'Add again' : 'Add to agenda'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      <Dialog ref={dialogRef} onClose={() => setOpenFor(null)}>
        {openFor && (
          <SessionForm
            key={'newIn' in openFor ? `new-${openFor.newIn}` : openFor.id}
            row={'newIn' in openFor ? null : openFor}
            section={'newIn' in openFor ? openFor.newIn : openFor.section}
            meetingId={meeting.id}
            onCreate={onCreateSession}
            onUpdate={onUpdateSession}
            onClose={() => setOpenFor(null)}
          />
        )}
      </Dialog>
    </>
  );
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  placeholder,
  required
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className={styles.editField}>
      <span className={styles.editLabel}>{label}</span>
      <input
        type={type}
        name={name}
        className={styles.editInput}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}

function SessionPanel({
  title,
  emptyNote,
  rows,
  busyKey,
  onAdd,
  onEdit,
  onDelete,
  onMove
}: {
  title: string;
  emptyNote: string;
  rows: MeetingSession[];
  meetingId: number;
  busyKey: string | null;
  onAdd: () => void;
  onEdit: (s: MeetingSession) => void;
  onDelete: (s: MeetingSession) => void;
  onMove: (s: MeetingSession, dir: 'up' | 'down') => void;
}) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>
        <span>{title}</span>
        <button type="button" className={styles.editBtn} onClick={onAdd}>
          + Add item
        </button>
      </div>
      {rows.length === 0 ? (
        <p className={styles.muted}>{emptyNote}</p>
      ) : (
        rows.map((s, i) => (
          <div key={s.id} className={styles.sessionRow}>
            <div className={styles.sessionTime}>{s.time_label ?? ''}</div>
            <div className={styles.sessionBody}>
              <div className={styles.sessionTitle}>
                {s.title}
                {s.track && <span className={styles.trackBadge}>{s.track}</span>}
              </div>
              {(s.leader_name || s.contact_name) && (
                <div className={styles.sessionMeta}>
                  {s.leader_name && <>Led by {s.leader_name}</>}
                  {s.leader_name && s.contact_name && ' · '}
                  {s.contact_name && (
                    <>
                      Contact: {s.contact_name}
                      {s.contact_phone && ` (${s.contact_phone})`}
                    </>
                  )}
                </div>
              )}
              {s.description && <div className={styles.sessionDesc}>{s.description}</div>}
              {s.scouts && s.scouts.length > 0 && (
                <div className={styles.sessionScouts}>
                  <strong>Scouts:</strong> {s.scouts.join(', ')}
                </div>
              )}
            </div>
            <div className={styles.sessionBtns}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => onMove(s, 'up')}
                disabled={i === 0 || busyKey === `move-${s.id}`}
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => onMove(s, 'down')}
                disabled={i === rows.length - 1 || busyKey === `move-${s.id}`}
                aria-label="Move down"
              >
                ↓
              </button>
            </div>
            <div>
              <button type="button" className={styles.editBtn} onClick={() => onEdit(s)}>
                Edit
              </button>
              <button
                type="button"
                className={`${styles.editBtn} ${styles.dangerBtn}`}
                onClick={() => onDelete(s)}
                disabled={busyKey === `del-${s.id}`}
              >
                {busyKey === `del-${s.id}` ? '…' : 'Remove'}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function SessionForm({
  row,
  section,
  meetingId,
  onCreate,
  onUpdate,
  onClose
}: {
  row: MeetingSession | null;
  section: MeetingSection;
  meetingId: number;
  onCreate: (fd: FormData) => Promise<ActionResult>;
  onUpdate: (fd: FormData) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const isNew = row === null;
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const { dirty } = useFormDirty(formRef);
  const feedback = useSavePhase();

  function submit() {
    const form = formRef.current;
    if (!form) return;
    setErr(null);
    const fd = new FormData(form);
    fd.set('meeting_id', String(meetingId));
    if (row) fd.set('id', String(row.id));
    feedback.start();
    startTransition(async () => {
      const res = isNew ? await onCreate(fd) : await onUpdate(fd);
      if (!res.ok) {
        feedback.fail();
        setErr(res.error ?? 'Save failed.');
        return;
      }
      feedback.doneThen(onClose);
    });
  }

  const isPre = section === 'pre_meeting';
  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
      <DialogHeader
        title={isNew ? (isPre ? 'Add Pre-Meeting Item' : 'Add Agenda Item') : `Edit: ${row?.title}`}
        sub={
          isPre
            ? 'Shows in the "Before the Meeting" section — early advancement help, setup crews, and the like.'
            : 'One row in the meeting agenda. Time is a label ("4:10"), so parallel sessions can share it.'
        }
      />

      <DialogBody>
      <input type="hidden" name="section" value={section} />
      <div className={styles.editGrid}>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Time label</span>
          <input
            type="text"
            name="time_label"
            className={styles.editInput}
            defaultValue={row?.time_label ?? ''}
            placeholder={isPre ? '1:30 PM' : '4:10'}
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Track (optional)</span>
          <input
            type="text"
            name="track"
            className={styles.editInput}
            defaultValue={row?.track ?? ''}
            placeholder="Open Advancement / Merit Badge"
          />
        </label>
        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Title</span>
          <input type="text" name="title" className={styles.editInput} defaultValue={row?.title ?? ''} required />
        </label>
        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Description</span>
          <textarea name="description" className={styles.editInput} defaultValue={row?.description ?? ''} />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Led by (optional)</span>
          <input
            type="text"
            name="leader_name"
            className={styles.editInput}
            defaultValue={row?.leader_name ?? ''}
            placeholder="Patrol Leaders / Nina Bendre"
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Scouts (comma-separated, optional)</span>
          <input
            type="text"
            name="scouts"
            className={styles.editInput}
            defaultValue={row?.scouts?.join(', ') ?? ''}
            placeholder="Anjali S., Finn P."
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Contact name (optional)</span>
          <input
            type="text"
            name="contact_name"
            className={styles.editInput}
            defaultValue={row?.contact_name ?? ''}
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Contact phone (members only)</span>
          <input
            type="text"
            name="contact_phone"
            className={styles.editInput}
            defaultValue={row?.contact_phone ?? ''}
            placeholder="Shown after login, never public"
          />
        </label>
      </div>

      {err && <Notice>{err}</Notice>}
      </DialogBody>

      <DialogActions>
        <button type="button" className={styles.editBtn} onClick={onClose} disabled={isPending}>
          Cancel
        </button>
        <SaveButton
          className={styles.editSaveBtn}
          dirty={dirty}
          pending={isPending}
          isNew={isNew}
          newLabel="Add item"
          onClick={submit}
        />
        <SaveFeedback phase={feedback.phase} />
      </DialogActions>
    </form>
  );
}
