'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  updateSignup, addPrice, deletePrice, updatePrice,
  addSlot, deleteSlot, updateSlot, addQuestion, deleteQuestion, disableSignup
} from '../actions';
import styles from '../events-admin.module.css';

/*
 * Block checklist + sub-editors. Toggling a block saves immediately — a
 * leader setting up an event between meetings shouldn't have to hunt for a
 * Save button and wonder whether it took.
 */

type Rec = Record<string, unknown>;
const b = (v: unknown) => v === true;
const s = (v: unknown) => (v == null ? '' : String(v));

/** Declared at module scope on purpose: a component created inside render is a
 *  new type on every pass, so React remounts it and any state it holds is
 *  lost. */
function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={styles.toggleRow}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        {hint && <span className={styles.toggleHint}>{hint}</span>}
      </span>
    </label>
  );
}

export function BuilderPanels({
  signupId,
  calendarEntryId,
  signup,
  prices,
  slots,
  questions
}: {
  signupId: number;
  calendarEntryId: number;
  signup: Rec;
  prices: Rec[];
  slots: Rec[];
  questions: Rec[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const save = (fields: Record<string, unknown>) =>
    start(async () => {
      setError(null);
      const res = await updateSignup(signupId, calendarEntryId, fields);
      if (!res.ok) setError(res.error ?? 'Could not save.');
      else router.refresh();
    });

  const attendance = b(signup.attendance_enabled);
  const slotDriven = !attendance && slots.length > 0;

  // Price tier draft
  const [pLabel, setPLabel] = useState('');
  const [pAmount, setPAmount] = useState('0');
  const [pPer, setPPer] = useState<'event' | 'day'>('event');
  const [pWho, setPWho] = useState<'scouts' | 'adults' | 'both'>('both');

  // Slot draft
  const [sKind, setSKind] = useState<'shift' | 'task'>('shift');
  const [sLabel, setSLabel] = useState('');
  const [sDate, setSDate] = useState('');
  const [sStart, setSStart] = useState('08:00');
  const [sEnd, setSEnd] = useState('10:00');
  const [sWho, setSWho] = useState<'scouts' | 'adults' | 'both'>('both');
  const [sNeeded, setSNeeded] = useState('4');
  const [sAttend, setSAttend] = useState(true);

  // Inline edit state: which row is open, plus its draft values.
  const [editSlot, setEditSlot] = useState<number | null>(null);
  const [eSlot, setESlot] = useState<Record<string, string>>({});
  const [editPrice, setEditPrice] = useState<number | null>(null);
  const [dangerArmed, setDangerArmed] = useState(false);
  const [dangerWarning, setDangerWarning] = useState<string | null>(null);
  const [ePrice, setEPrice] = useState<Record<string, string>>({});

  // Question draft
  const [qPrompt, setQPrompt] = useState('');
  const [qType, setQType] = useState<'text' | 'number' | 'choice'>('text');
  const [qChoices, setQChoices] = useState('');
  const [qWho, setQWho] = useState<'scouts' | 'adults' | 'both'>('both');
  const [qReq, setQReq] = useState(true);

  return (
    <div className={styles.builder}>
      {error && <p className={styles.err}>{error}</p>}

      <section className={styles.panel}>
        <h2>Blocks</h2>
        <p className={styles.panelHint}>
          Seeded from the event’s category — change anything. Turning attendance off makes this a
          job-first signup, where claiming a job <em>is</em> the RSVP.
        </p>
        <Toggle
          checked={b(signup.attendance_enabled)}
          disabled={pending}
          onChange={(v) => save({ attendance_enabled: v })}
          label="Attendance (RSVP per person)"
          hint="Off for fundraisers — the job list becomes the signup."
        
        />
        <Toggle
          checked={b(signup.drivers_needed)}
          disabled={pending}
          onChange={(v) => save({ drivers_needed: v })} label="Drivers" hint="Offer seats per leg, there and back." 
        />
        <Toggle
          checked={b(signup.allow_guests)}
          disabled={pending}
          onChange={(v) => save({ allow_guests: v })} label="Guests" hint="Families can bring a counted number of guests." 
        />
        <Toggle
          checked={b(signup.needs_permission_slip)}
          disabled={pending}
          onChange={(v) => save({ needs_permission_slip: v })} label="Permission slip required" 
        />
        <Toggle
          checked={b(signup.needs_ahmr_c)}
          disabled={pending}
          onChange={(v) => save({ needs_ahmr_c: v })} label="AHMR Part C required" hint="Events running 72+ hours." 
        />
        <Toggle
          checked={b(signup.waitlist_enabled)}
          disabled={pending}
          onChange={(v) => save({ waitlist_enabled: v })} label="Waitlist when full" hint="Requires a capacity." 
        />

        {slotDriven && (
          <p className={styles.note}>
            This event is <strong>job-first</strong>: families will see the job list, not a per-person
            RSVP.
          </p>
        )}
      </section>

      <section className={styles.panel}>
        <h2>Settings</h2>
        <div className={styles.fieldGrid}>
          <label>
            <span className={styles.fieldLabel}>Signup deadline</span>
            <input
              type="datetime-local"
              defaultValue={s(signup.deadline).slice(0, 16)}
              onBlur={(e) =>
                e.target.value && save({ deadline: new Date(e.target.value).toISOString() })
              }
            />
          </label>
          <label>
            <span className={styles.fieldLabel}>Capacity (blank = no limit)</span>
            <input
              type="number"
              min={1}
              defaultValue={s(signup.capacity)}
              onBlur={(e) => save({ capacity: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
          <label>
            <span className={styles.fieldLabel}>Who it’s for</span>
            <select defaultValue={s(signup.audience)} onChange={(e) => save({ audience: e.target.value })}>
              <option value="both">Everyone</option>
              <option value="scouts">Scouts only</option>
              <option value="adults">Adults only</option>
            </select>
          </label>
          <label>
            <span className={styles.fieldLabel}>Status</span>
            <select defaultValue={s(signup.status)} onChange={(e) => save({ status: e.target.value })}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        </div>
        <label className={styles.fullField}>
          <span className={styles.fieldLabel}>Payment instructions</span>
          <textarea
            rows={2}
            defaultValue={s(signup.payment_instructions)}
            onBlur={(e) => save({ payment_instructions: e.target.value || null })}
          />
        </label>
        <label className={styles.fullField}>
          <span className={styles.fieldLabel}>Question to ask each household (optional)</span>
          <input
            type="text"
            placeholder="e.g. Allergies or dietary needs we should know about?"
            defaultValue={s(signup.notes_prompt)}
            onBlur={(e) => save({ notes_prompt: e.target.value || null })}
          />
        </label>
      </section>

      <section className={styles.panel}>
        <h2>Price tiers</h2>
        <p className={styles.panelHint}>
          No tiers = a free event. Costs differ by who’s attending, so add one per class of
          participant. Amount owed is always derived, never stored.
        </p>
        {prices.length > 0 && (
          <table className={styles.miniTable}>
            <tbody>
              {prices.map((p) => {
                const pid = Number(p.id);
                if (editPrice === pid) {
                  return (
                    <tr key={pid} className={styles.editRow}>
                      <td colSpan={4}>
                        <div className={styles.addRow}>
                          <input
                            value={ePrice.label ?? ''}
                            placeholder="Label"
                            onChange={(ev) => setEPrice((v) => ({ ...v, label: ev.target.value }))}
                          />
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={ePrice.amount ?? '0'}
                            onChange={(ev) => setEPrice((v) => ({ ...v, amount: ev.target.value }))}
                          />
                          <select
                            value={ePrice.per ?? 'event'}
                            onChange={(ev) => setEPrice((v) => ({ ...v, per: ev.target.value }))}
                          >
                            <option value="event">per event</option>
                            <option value="day">per day</option>
                          </select>
                          <select
                            value={ePrice.applies_to ?? 'both'}
                            onChange={(ev) => setEPrice((v) => ({ ...v, applies_to: ev.target.value }))}
                          >
                            <option value="both">Everyone</option>
                            <option value="scouts">Scouts</option>
                            <option value="adults">Adults</option>
                          </select>
                          <button
                            type="button"
                            className={styles.enableBtn}
                            disabled={pending}
                            onClick={() =>
                              start(async () => {
                                const res = await updatePrice(pid, signupId, calendarEntryId, {
                                  label: ePrice.label ?? '',
                                  amount: Number(ePrice.amount) || 0,
                                  per: (ePrice.per ?? 'event') as 'event' | 'day',
                                  applies_to: (ePrice.applies_to ?? 'both') as
                                    | 'scouts'
                                    | 'adults'
                                    | 'both'
                                });
                                if (!res.ok) setError(res.error ?? 'Could not save tier.');
                                else {
                                  setEditPrice(null);
                                  router.refresh();
                                }
                              })
                            }
                          >
                            Save
                          </button>
                          <button type="button" className={styles.rowDel} onClick={() => setEditPrice(null)}>
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={pid}>
                    <td>
                      <strong>{s(p.label)}</strong>
                    </td>
                    <td>
                      ${Number(p.amount)}
                      {s(p.per) === 'day' && '/day'}
                    </td>
                    <td>{s(p.applies_to)}</td>
                    <td className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.rowEdit}
                        disabled={pending}
                        onClick={() => {
                          setEditPrice(pid);
                          setEPrice({
                            label: s(p.label),
                            amount: s(p.amount),
                            per: s(p.per),
                            applies_to: s(p.applies_to)
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={styles.rowDel}
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const res = await deletePrice(pid, signupId, calendarEntryId);
                            if (!res.ok) setError(res.error ?? 'Could not remove tier.');
                            else router.refresh();
                          })
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className={styles.addRow}>
          <input placeholder="Label (e.g. Adult — chaperone)" value={pLabel} onChange={(e) => setPLabel(e.target.value)} />
          <input type="number" min={0} step="0.01" value={pAmount} onChange={(e) => setPAmount(e.target.value)} />
          <select value={pPer} onChange={(e) => setPPer(e.target.value as 'event' | 'day')}>
            <option value="event">per event</option>
            <option value="day">per day</option>
          </select>
          <select value={pWho} onChange={(e) => setPWho(e.target.value as 'scouts' | 'adults' | 'both')}>
            <option value="both">Everyone</option>
            <option value="scouts">Scouts</option>
            <option value="adults">Adults</option>
          </select>
          <button
            type="button"
            className={styles.enableBtn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await addPrice(signupId, calendarEntryId, pLabel, Number(pAmount) || 0, pPer, pWho);
                if (!res.ok) setError(res.error ?? 'Could not add tier.');
                else {
                  setPLabel('');
                  setPAmount('0');
                  router.refresh();
                }
              })
            }
          >
            Add tier
          </button>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Jobs — shifts &amp; tasks</h2>
        <p className={styles.panelHint}>
          One mechanism: a task is a shift without times. A task that doesn’t need attendance (a
          donation) can be claimed by someone who isn’t coming.
        </p>
        {slots.length > 0 && (
          <table className={styles.miniTable}>
            <tbody>
              {slots.map((sl) => {
                const id = Number(sl.id);
                const isShift = s(sl.kind) === 'shift';
                if (editSlot === id) {
                  return (
                    <tr key={id} className={styles.editRow}>
                      <td colSpan={5}>
                        <div className={styles.addRow}>
                          <input
                            value={eSlot.label ?? ''}
                            placeholder="Job name"
                            onChange={(ev) => setESlot((v) => ({ ...v, label: ev.target.value }))}
                          />
                          <input
                            type="date"
                            value={eSlot.slot_date ?? ''}
                            onChange={(ev) => setESlot((v) => ({ ...v, slot_date: ev.target.value }))}
                          />
                          {isShift && (
                            <>
                              <input
                                type="time"
                                value={eSlot.starts_at ?? ''}
                                onChange={(ev) => setESlot((v) => ({ ...v, starts_at: ev.target.value }))}
                              />
                              <input
                                type="time"
                                value={eSlot.ends_at ?? ''}
                                onChange={(ev) => setESlot((v) => ({ ...v, ends_at: ev.target.value }))}
                              />
                            </>
                          )}
                          <select
                            value={eSlot.eligibility ?? 'both'}
                            onChange={(ev) => setESlot((v) => ({ ...v, eligibility: ev.target.value }))}
                          >
                            <option value="both">Everyone</option>
                            <option value="scouts">Scouts</option>
                            <option value="adults">Adults</option>
                          </select>
                          <input
                            type="number"
                            min={1}
                            placeholder="needed"
                            value={eSlot.needed ?? ''}
                            onChange={(ev) => setESlot((v) => ({ ...v, needed: ev.target.value }))}
                          />
                          {!isShift && (
                            <label className={styles.inlineChk}>
                              <input
                                type="checkbox"
                                checked={eSlot.attendance_required === '1'}
                                onChange={(ev) =>
                                  setESlot((v) => ({
                                    ...v,
                                    attendance_required: ev.target.checked ? '1' : ''
                                  }))
                                }
                              />
                              needs attendance
                            </label>
                          )}
                          <button
                            type="button"
                            className={styles.enableBtn}
                            disabled={pending}
                            onClick={() =>
                              start(async () => {
                                const res = await updateSlot(id, signupId, calendarEntryId, {
                                  label: eSlot.label ?? '',
                                  slot_date: eSlot.slot_date || null,
                                  starts_at: eSlot.starts_at || null,
                                  ends_at: eSlot.ends_at || null,
                                  eligibility: (eSlot.eligibility ?? 'both') as
                                    | 'scouts'
                                    | 'adults'
                                    | 'both',
                                  needed: eSlot.needed ? Number(eSlot.needed) : null,
                                  attendance_required: eSlot.attendance_required === '1'
                                });
                                if (!res.ok) setError(res.error ?? 'Could not save job.');
                                else {
                                  setEditSlot(null);
                                  router.refresh();
                                }
                              })
                            }
                          >
                            Save
                          </button>
                          <button type="button" className={styles.rowDel} onClick={() => setEditSlot(null)}>
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={id}>
                    <td>
                      <strong>{s(sl.label)}</strong>
                      {b(sl.attendance_required) === false && (
                        <span className={styles.tag}>no attendance</span>
                      )}
                    </td>
                    <td className={styles.nowrap}>
                      {s(sl.slot_date) || '—'}{' '}
                      {s(sl.starts_at)
                        ? `${s(sl.starts_at).slice(0, 5)}–${s(sl.ends_at).slice(0, 5)}`
                        : ''}
                    </td>
                    <td>{s(sl.eligibility)}</td>
                    <td className={styles.nowrap}>
                      {sl.needed == null ? 'no limit' : `${s(sl.needed)} needed`}
                    </td>
                    <td className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.rowEdit}
                        disabled={pending}
                        onClick={() => {
                          setEditSlot(id);
                          setESlot({
                            label: s(sl.label),
                            slot_date: s(sl.slot_date),
                            starts_at: s(sl.starts_at).slice(0, 5),
                            ends_at: s(sl.ends_at).slice(0, 5),
                            eligibility: s(sl.eligibility),
                            needed: sl.needed == null ? '' : s(sl.needed),
                            attendance_required: b(sl.attendance_required) ? '1' : ''
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={styles.rowDel}
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const res = await deleteSlot(id, signupId, calendarEntryId);
                            if (!res.ok) setError(res.error ?? 'Could not remove job.');
                            else router.refresh();
                          })
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className={styles.addRow}>
          <select value={sKind} onChange={(e) => setSKind(e.target.value as 'shift' | 'task')}>
            <option value="shift">Shift (timed)</option>
            <option value="task">Task (untimed)</option>
          </select>
          <input placeholder="Job name" value={sLabel} onChange={(e) => setSLabel(e.target.value)} />
          <input type="date" value={sDate} onChange={(e) => setSDate(e.target.value)} />
          {sKind === 'shift' && (
            <>
              <input type="time" value={sStart} onChange={(e) => setSStart(e.target.value)} />
              <input type="time" value={sEnd} onChange={(e) => setSEnd(e.target.value)} />
            </>
          )}
          <select value={sWho} onChange={(e) => setSWho(e.target.value as 'scouts' | 'adults' | 'both')}>
            <option value="both">Everyone</option>
            <option value="scouts">Scouts</option>
            <option value="adults">Adults</option>
          </select>
          <input
            type="number"
            min={1}
            placeholder="needed"
            value={sNeeded}
            onChange={(e) => setSNeeded(e.target.value)}
          />
          {sKind === 'task' && (
            <label className={styles.inlineChk}>
              <input type="checkbox" checked={sAttend} onChange={(e) => setSAttend(e.target.checked)} />
              needs attendance
            </label>
          )}
          <button
            type="button"
            className={styles.enableBtn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await addSlot(signupId, calendarEntryId, {
                  kind: sKind,
                  label: sLabel,
                  slot_date: sDate || null,
                  starts_at: sStart,
                  ends_at: sEnd,
                  eligibility: sWho,
                  needed: sNeeded ? Number(sNeeded) : null,
                  attendance_required: sKind === 'shift' ? true : sAttend
                });
                if (!res.ok) setError(res.error ?? 'Could not add job.');
                else {
                  setSLabel('');
                  router.refresh();
                }
              })
            }
          >
            Add job
          </button>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Questions asked of each attendee</h2>
        <p className={styles.panelHint}>
          Per person, not per household — the ski outing needs every skier’s own height, weight and
          shoe size before the rental shop can stage gear. Answers are validated server-side.
        </p>
        {questions.length > 0 && (
          <table className={styles.miniTable}>
            <tbody>
              {questions.map((q) => (
                <tr key={String(q.id)}>
                  <td>
                    <strong>{s(q.prompt)}</strong>
                    {b(q.required) && <span className={styles.tag}>required</span>}
                  </td>
                  <td>{s(q.input_type)}</td>
                  <td>{Array.isArray(q.choices) ? (q.choices as string[]).join(' / ') : '—'}</td>
                  <td>{s(q.applies_to)}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.rowDel}
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const res = await deleteQuestion(Number(q.id), signupId, calendarEntryId);
                          if (!res.ok) setError(res.error ?? 'Could not remove question.');
                          else router.refresh();
                        })
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className={styles.addRow}>
          <input
            placeholder="Question (e.g. Shoe size)"
            value={qPrompt}
            onChange={(e) => setQPrompt(e.target.value)}
          />
          <select value={qType} onChange={(e) => setQType(e.target.value as 'text' | 'number' | 'choice')}>
            <option value="text">Short text</option>
            <option value="number">Number</option>
            <option value="choice">Pick one</option>
          </select>
          {qType === 'choice' && (
            <input
              placeholder="Options, comma separated"
              value={qChoices}
              onChange={(e) => setQChoices(e.target.value)}
            />
          )}
          <select value={qWho} onChange={(e) => setQWho(e.target.value as 'scouts' | 'adults' | 'both')}>
            <option value="both">Everyone</option>
            <option value="scouts">Scouts</option>
            <option value="adults">Adults</option>
          </select>
          <label className={styles.inlineChk}>
            <input type="checkbox" checked={qReq} onChange={(e) => setQReq(e.target.checked)} />
            required
          </label>
          <button
            type="button"
            className={styles.enableBtn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await addQuestion(signupId, calendarEntryId, {
                  prompt: qPrompt,
                  input_type: qType,
                  choices: qChoices.split(',').map((c) => c.trim()).filter(Boolean),
                  applies_to: qWho,
                  required: qReq
                });
                if (!res.ok) setError(res.error ?? 'Could not add question.');
                else {
                  setQPrompt('');
                  setQChoices('');
                  router.refresh();
                }
              })
            }
          >
            Add question
          </button>
        </div>
      </section>
      <section className={styles.dangerPanel}>
        <h2>Remove signup from this event</h2>
        <p className={styles.panelHint}>
          For an event that never needed a signup — a planning entry, say — or one enabled by
          mistake. This deletes the jobs, price tiers, questions and any entries families have
          submitted. The calendar entry itself stays; only the signup goes.
        </p>
        {dangerWarning && <p className={styles.err}>{dangerWarning}</p>}
        {dangerArmed ? (
          <div className={styles.addRow}>
            <button
              type="button"
              className={styles.dangerBtn}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await disableSignup(signupId, calendarEntryId, true);
                  if (!res.ok) {
                    setDangerWarning(res.error ?? 'Could not remove the signup.');
                    return;
                  }
                  router.push('/admin/events');
                })
              }
            >
              Yes, delete this signup
            </button>
            <button
              type="button"
              className={styles.rowEdit}
              onClick={() => {
                setDangerArmed(false);
                setDangerWarning(null);
              }}
            >
              Keep it
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.dangerBtn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                // Dry run: reports how many people would lose their signup
                // before the leader agrees to anything.
                const res = await disableSignup(signupId, calendarEntryId, false);
                if (res.ok) {
                  router.push('/admin/events');
                  return;
                }
                setDangerWarning(res.error ?? null);
                if (res.needsConfirm) setDangerArmed(true);
                else setDangerArmed(true);
              })
            }
          >
            Remove signup
          </button>
        )}
      </section>
    </div>
  );
}
