'use client';

/**
 * "Would you like to update attendance?" (Build a Plan B8, Plans/Build-A-Plan.md; D-429). Shown to planner editors (the
 * SPL included) on Meeting Live and on Who's coming once the last meeting is over. Nothing about attendance is
 * automatic: Live's taps are a draft, and this is where they become Roll Call.
 *
 * The prompt opens a checklist (the shared Drawer) pre-filled from the draft: placed scouts, teachers, visitors and
 * anyone ticked here, grouped, one tick each, with who is already recorded marked. "Record N changes"
 * sends only the differences (plannerRecordAttendanceAction, Roll Call's cascade with its ledger credit). A recorded
 * person starts ticked, so removing them takes a deliberate untick. Re-running shows what's recorded and applies only
 * changes; with nothing to change the button is greyed and says "Attendance recorded". The button counts the changes
 * ("Record 3 changes"), with "Adds 2 · Removes 1" beside it. The pages key this on the meeting's entry id, so the
 * "Attendance recorded…" status survives the refresh that follows a save.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Drawer } from '@/app/_components/drawer';
import { attendanceChanges, type AttendanceReview } from '@/lib/meeting-live-shared';
import { plannerRecordAttendanceAction } from './live-actions';
import s from './attendance-review.module.css';

const FAILED = 'That didn’t save. Check your connection and try again.';
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
const changesLabel = (n: number) => `Record ${n} ${n === 1 ? 'change' : 'changes'}`;

export function AttendancePrompt({ review, label }: { review: AttendanceReview; label: string }) {
  const router = useRouter();
  const all = review.groups.flatMap((g) => g.people);
  const initial = () => new Set(all.filter((p) => p.ticked).map((p) => p.personId));
  const pending = attendanceChanges(review, initial());
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<Set<number>>(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const changes = attendanceChanges(review, ticked);
  const dirty = changes.add.length + changes.remove.length > 0;
  const recordedCount = all.filter((p) => p.recorded).length;

  const toggle = (id: number) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const openList = () => {
    setTicked(initial());
    setProblem(null);
    setOpen(true);
  };
  const record = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await plannerRecordAttendanceAction({ entryId: review.entryId, add: changes.add, remove: changes.remove });
      if (!res.ok) return setProblem(res.error);
      setDone(res.failed ? `Recorded, but ${people(res.failed)} didn’t save. Open the list to try again.` : `Attendance recorded for ${label}.`);
      setOpen(false);
      router.refresh();
    } catch {
      setProblem(FAILED);
    } finally {
      setBusy(false);
    }
  };

  const sum = [changes.add.length ? `Adds ${changes.add.length}` : '', changes.remove.length ? `Removes ${changes.remove.length}` : ''].filter(Boolean).join(' · ');
  return (
    <section className={s.prompt} aria-label="Attendance">
      {pending.add.length + pending.remove.length > 0 ? (
        <>
          <p className={s.ask}>Would you like to update attendance for {label}?</p>
          <Button variant="secondary" onClick={openList}>
            Update attendance
          </Button>
        </>
      ) : (
        <>
          <p className={s.quiet}>Attendance for {label} is recorded.</p>
          <button type="button" className={s.link} onClick={openList}>
            Review
          </button>
        </>
      )}
      {done ? (
        <p className={s.done} role="status">
          {done}
        </p>
      ) : null}
      {open ? (
        <Drawer
          eyebrow="Attendance"
          title={label}
          sub={recordedCount ? `${people(recordedCount)} already recorded` : 'Nobody recorded yet'}
          onClose={() => setOpen(false)}
          footer={
            <div className={s.foot}>
              {problem ? (
                <p className={s.problem} role="alert">
                  {problem}
                </p>
              ) : null}
              {sum ? <p className={s.sum}>{sum}</p> : null}
              <Button onClick={record} disabled={!dirty || busy} title={dirty ? undefined : 'No changes to record'}>
                {busy ? 'Recording…' : dirty ? changesLabel(changes.add.length + changes.remove.length) : 'Attendance recorded'}
              </Button>
            </div>
          }
        >
          {review.groups.map((g) => (
            <fieldset key={g.key} className={s.group}>
              <legend className={s.legend}>
                {g.label} ({g.people.length})
              </legend>
              <ul className={s.list}>
                {g.people.map((p) => (
                  <li key={p.personId}>
                    <label className={s.row}>
                      <input type="checkbox" className={s.box} checked={ticked.has(p.personId)} onChange={() => toggle(p.personId)} />
                      <span className={s.name}>{p.name}</span>
                      {p.recorded ? <span className={s.tag}>recorded</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ))}
        </Drawer>
      ) : null}
    </section>
  );
}
