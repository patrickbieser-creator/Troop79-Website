'use client';

import { useMemo, useState } from 'react';
import type {
  EventPrice,
  EventSignup,
  HouseholdEntry,
  SignupQuestion,
  SignupSlot
} from '@/lib/event-signup';
import type { Household, HouseholdAdult } from '@/lib/households';
import styles from './event-detail.module.css';

/*
 * PERSON-FIRST signup — campouts, ski outings, summer camp.
 *
 * Here the PERSON is the unit: each one RSVPs, picks a price tier, and adults
 * may offer driver seats. (Fundraisers use the slot-first surface instead,
 * where claiming a job is the signup.)
 *
 * Amount owed is computed live but never stored — the roster derives it the
 * same way, so the two can't drift.
 */

type ScoutChoice = 'yes' | 'no' | '';
type AdultChoice = 'full' | 'driver_only' | 'no' | '';

interface AdHocAdult {
  tempId: string;
  name: string;
  email: string;
  relationship: string;
}

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

export default function PersonFirstForm({
  eventId,
  signup,
  household,
  prices,
  questions,
  slots,
  existingClaims,
  existing,
  submitAction,
  cancelAction
}: {
  eventId: number;
  signup: EventSignup;
  household: Household;
  prices: EventPrice[];
  questions: SignupQuestion[];
  slots: SignupSlot[];
  existingClaims: { slotId: number; personKey: string }[];
  existing: HouseholdEntry[];
  submitAction: (fd: FormData) => void;
  cancelAction: (fd: FormData) => void;
}) {
  const slotsTitle = signup.slots_title ?? 'What can you bring?';
  const slotsIntro =
    signup.slots_intro ??
    'Tell us what your family is bringing so we don’t end up with fifteen desserts and no salad.';

  const scouts = household.scouts;
  const adults = household.adults;
  /** A stored `households` row, as opposed to the `scout:<id>` / `leader:<code>`
   *  parties that stand alone. Gates anything that needs a household id. */
  const hasStoredHousehold = /^\d+$/.test(household.key);

  const priorScout = (id: string) => existing.find((e) => e.scout_id === id);
  /* Adults come from two tables now (parent rows and the leader roster), so a
     prior entry matches on whichever identity column this adult carries. */
  const priorAdult = (a: HouseholdAdult) =>
    existing.find(
      (e) =>
        (a.scoutParentId != null && e.scout_parent_id === a.scoutParentId) ||
        (a.leaderCode != null && e.leader_code === a.leaderCode)
    );

  const [scoutChoice, setScoutChoice] = useState<Record<string, ScoutChoice>>(() =>
    Object.fromEntries(
      scouts.map((s) => {
        const p = priorScout(s.id);
        return [s.id, p ? (p.status === 'yes' || p.status === 'waitlist' ? 'yes' : 'no') : ''];
      })
    )
  );
  const [adultChoice, setAdultChoice] = useState<Record<string, AdultChoice>>(() =>
    Object.fromEntries(
      adults.map((a) => {
        const p = priorAdult(a);
        if (!p) return [a.key, ''];
        return [a.key, p.participation === 'driver_only' ? 'driver_only' : 'full'];
      })
    )
  );
  const [tier, setTier] = useState<Record<string, number | null>>(() => {
    const init: Record<string, number | null> = {};
    for (const s of scouts) init[`s:${s.id}`] = priorScout(s.id)?.price_id ?? null;
    for (const a of adults) init[`a:${a.key}`] = priorAdult(a)?.price_id ?? null;
    return init;
  });
  const [days, setDays] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const s of scouts) init[`s:${s.id}`] = priorScout(s.id)?.days ?? 1;
    for (const a of adults) init[`a:${a.key}`] = priorAdult(a)?.days ?? 1;
    return init;
  });
  const [drives, setDrives] = useState<Record<string, { out: boolean; back: boolean; seats: number }>>(
    () => Object.fromEntries(adults.map((a) => [a.key, { out: false, back: false, seats: 3 }]))
  );
  const [guests, setGuests] = useState(existing[0]?.guest_count ?? 0);
  const [guestNote, setGuestNote] = useState(existing[0]?.guest_note ?? '');
  const [notes, setNotes] = useState(existing[0]?.notes ?? '');
  const [newAdults, setNewAdults] = useState<AdHocAdult[]>([]);
  const [claims, setClaims] = useState<Record<number, string[]>>(() => {
    const init: Record<number, string[]> = {};
    for (const c of existingClaims) init[c.slotId] = [...(init[c.slotId] ?? []), c.personKey];
    return init;
  });
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  // answers[personKey][questionId]
  const [answers, setAnswers] = useState<Record<string, Record<number, string>>>(() => {
    const init: Record<string, Record<number, string>> = {};
    for (const e of existing) {
      const key = e.scout_id ? `s:${e.scout_id}` : `a:${e.scout_parent_id}`;
      init[key] = Object.fromEntries((e.answers ?? []).map((x) => [x.question_id, x.value]));
    }
    return init;
  });

  const questionsFor = (kind: 'scout' | 'adult') =>
    questions.filter(
      (q) => q.applies_to === 'both' || q.applies_to === (kind === 'scout' ? 'scouts' : 'adults')
    );

  const answerArr = (key: string, kind: 'scout' | 'adult') =>
    questionsFor(kind)
      .map((q) => ({ question_id: q.id, value: answers[key]?.[q.id] ?? '' }))
      .filter((a) => a.value !== '');

  const questionFields = (key: string, kind: 'scout' | 'adult') => {
    const qs = questionsFor(kind);
    if (qs.length === 0) return null;
    return (
      <div className={styles.qaGrid}>
        {qs.map((q) => (
          <label key={q.id} className={styles.qaField}>
            <span className={styles.miniLabel}>
              {q.prompt}
              {!q.required && <span className={styles.optional}> (optional)</span>}
            </span>
            {q.input_type === 'choice' ? (
              <div className={styles.pillRow}>
                {(q.choices ?? []).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`${styles.pill} ${answers[key]?.[q.id] === c ? styles.pillOn : ''}`}
                    aria-pressed={answers[key]?.[q.id] === c}
                    onClick={() =>
                      setAnswers((v) => ({ ...v, [key]: { ...(v[key] ?? {}), [q.id]: c } }))
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
            ) : (
              <input
                type={q.input_type === 'number' ? 'number' : 'text'}
                className={styles.numInputWide}
                value={answers[key]?.[q.id] ?? ''}
                onChange={(e) =>
                  setAnswers((v) => ({ ...v, [key]: { ...(v[key] ?? {}), [q.id]: e.target.value } }))
                }
              />
            )}
          </label>
        ))}
      </div>
    );
  };

  /** Only people marked as attending can take an item — you bring a dessert
   *  because you're coming. (The donate-without-attending case belongs to
   *  fundraisers, which use the job-first surface instead.) */
  const attendingPeople = () => [
    ...scouts
      .filter((sc) => scoutChoice[sc.id] === 'yes')
      .map((sc) => ({ key: `s:${sc.id}`, name: sc.displayName, kind: 'scout' as const })),
    ...adults
      .filter((a) => adultChoice[a.key] === 'full')
      .map((a) => ({ key: `a:${a.key}`, name: a.name, kind: 'adult' as const }))
  ];

  const claimersOf = (slotId: number) => claims[slotId] ?? [];
  const filledOf = (sl: SignupSlot) => {
    const mineExisting = existingClaims.filter((c) => c.slotId === sl.id).length;
    return sl.filled - mineExisting + claimersOf(sl.id).length;
  };
  const toggleClaim = (slotId: number, key: string) =>
    setClaims((prev) => {
      const cur = prev[slotId] ?? [];
      return {
        ...prev,
        [slotId]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
      };
    });

  const tiersFor = (kind: 'scout' | 'adult') =>
    prices.filter((p) => p.applies_to === 'both' || p.applies_to === (kind === 'scout' ? 'scouts' : 'adults'));

  // A single eligible tier needs no picker — it's implied.
  const autoTier = (kind: 'scout' | 'adult') => {
    const t = tiersFor(kind);
    return t.length === 1 ? t[0] : null;
  };
  const chosenTier = (key: string, kind: 'scout' | 'adult'): EventPrice | null => {
    const auto = autoTier(kind);
    if (auto) return auto;
    const id = tier[key];
    return id ? (prices.find((p) => p.id === id) ?? null) : null;
  };

  const lines = useMemo(() => {
    const out: { name: string; label: string; amount: number; math: string | null }[] = [];
    for (const s of scouts) {
      if (scoutChoice[s.id] !== 'yes') continue;
      const t = chosenTier(`s:${s.id}`, 'scout');
      if (!t) continue;
      const d = t.per === 'day' ? days[`s:${s.id}`] : 1;
      out.push({
        name: s.displayName,
        label: t.label,
        amount: t.amount * d,
        math: t.per === 'day' ? `${money(t.amount)} × ${d} days` : null
      });
    }
    for (const a of adults) {
      const c = adultChoice[a.key];
      if (c === 'driver_only') {
        out.push({ name: a.name, label: 'Driver only — not attending', amount: 0, math: null });
        continue;
      }
      if (c !== 'full') continue;
      const t = chosenTier(`a:${a.key}`, 'adult');
      if (!t) continue;
      const d = t.per === 'day' ? days[`a:${a.key}`] : 1;
      out.push({
        name: a.name,
        label: t.label,
        amount: t.amount * d,
        math: t.per === 'day' ? `${money(t.amount)} × ${d} days` : null
      });
    }
    return out;
  }, [scoutChoice, adultChoice, tier, days, scouts, adults, prices]);

  const total = lines.reduce((n, l) => n + l.amount, 0);

  const entries = useMemo(() => {
    const out: Record<string, unknown>[] = [];
    let guestsAssigned = false;
    for (const s of scouts) {
      const c = scoutChoice[s.id];
      if (!c) continue;
      const t = c === 'yes' ? chosenTier(`s:${s.id}`, 'scout') : null;
      out.push({
        key: `s:${s.id}`,
        person_kind: 'scout',
        scout_id: s.id,
        status: c,
        participation: 'full',
        price_id: t?.id ?? null,
        days: t?.per === 'day' ? days[`s:${s.id}`] : null,
        guest_count: 0,
        notes: notes || null,
        answers: c === 'yes' ? answerArr(`s:${s.id}`, 'scout') : []
      });
    }
    for (const a of adults) {
      const c = adultChoice[a.key];
      if (!c || c === 'no') continue;
      const attending = c === 'full';
      const t = attending ? chosenTier(`a:${a.key}`, 'adult') : null;
      const d = drives[a.key] ?? { out: false, back: false, seats: 3 };
      const wantsGuests = attending && !guestsAssigned && guests > 0;
      if (wantsGuests) guestsAssigned = true;
      out.push({
        key: `a:${a.key}`,
        person_kind: 'adult',
        /* Exactly one identity column, matching the signup_entries check
           constraint — a parent row, or a leader-roster adult with no scout. */
        scout_parent_id: a.scoutParentId,
        leader_code: a.leaderCode,
        status: 'yes',
        participation: attending ? 'full' : 'driver_only',
        price_id: t?.id ?? null,
        days: t?.per === 'day' ? days[`a:${a.key}`] : null,
        drives_out: d.out,
        drives_back: d.back,
        seats_offered_out: d.out ? d.seats : null,
        seats_offered_back: d.back ? d.seats : null,
        guest_count: wantsGuests ? guests : 0,
        guest_note: wantsGuests ? guestNote || null : null,
        notes: notes || null,
        answers: attending ? answerArr(`a:${a.key}`, 'adult') : []
      });
    }
    return out;
  }, [scoutChoice, adultChoice, tier, days, drives, guests, guestNote, notes, scouts, adults]);

  const anyChoice = entries.length > 0;

  const tierPicker = (key: string, kind: 'scout' | 'adult') => {
    const opts = tiersFor(kind);
    if (opts.length === 0) return null;
    const auto = autoTier(kind);
    const active = chosenTier(key, kind);
    return (
      <div className={styles.personExtra}>
        {!auto && (
          <div className={styles.tierPick}>
            <span className={styles.miniLabel}>Price</span>
            <div className={styles.pillRow}>
              {opts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`${styles.pill} ${tier[key] === p.id ? styles.pillOn : ''}`}
                  aria-pressed={tier[key] === p.id}
                  onClick={() => setTier((v) => ({ ...v, [key]: p.id }))}
                >
                  {p.label} — {money(p.amount)}
                  {p.per === 'day' && '/day'}
                </button>
              ))}
            </div>
          </div>
        )}
        {active?.per === 'day' && (
          <label className={styles.daysRow}>
            <span className={styles.miniLabel}>Days attending</span>
            <input
              type="number"
              min={1}
              max={14}
              value={days[key] ?? 1}
              onChange={(e) =>
                setDays((v) => ({ ...v, [key]: Math.max(1, Number(e.target.value) || 1) }))
              }
              className={styles.numInput}
            />
            <span className={styles.dayMath}>
              {money(active.amount)} × {days[key] ?? 1} ={' '}
              <strong>{money(active.amount * (days[key] ?? 1))}</strong>
            </span>
          </label>
        )}
      </div>
    );
  };

  return (
    <form action={submitAction} className={styles.signupForm}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="signupId" value={signup.id} />
      <input type="hidden" name="householdKey" value={household.key} />
      <input type="hidden" name="entries" value={JSON.stringify(entries)} />
      <input
        type="hidden"
        name="slotClaims"
        value={JSON.stringify(
          Object.entries(claims).reduce<Record<string, number[]>>((acc, [slotId, keys]) => {
            for (const k of keys) acc[k] = [...(acc[k] ?? []), Number(slotId)];
            return acc;
          }, {})
        )}
      />
      <input type="hidden" name="newAdults" value={JSON.stringify(newAdults.filter((a) => a.name.trim()))} />

      <p className={styles.formLede}>
        Mark each person, then submit once for the whole household. “Can’t make it” still helps — it
        tells the planners who <em>not</em> to wait for.
      </p>

      {signup.audience !== 'adults' && scouts.length > 0 && (
        <>
          <p className={styles.dayHead}>Scouts</p>
          {scouts.map((s) => (
            <div key={s.id} className={styles.personRow}>
              <div className={styles.personMain}>
                <span className={styles.personName}>{s.displayName}</span>
                <span className={styles.seg}>
                  <button
                    type="button"
                    className={`${styles.segBtn} ${scoutChoice[s.id] === 'yes' ? styles.segYes : ''}`}
                    aria-pressed={scoutChoice[s.id] === 'yes'}
                    onClick={() => setScoutChoice((v) => ({ ...v, [s.id]: 'yes' }))}
                  >
                    Attending
                  </button>
                  <button
                    type="button"
                    className={`${styles.segBtn} ${scoutChoice[s.id] === 'no' ? styles.segNo : ''}`}
                    aria-pressed={scoutChoice[s.id] === 'no'}
                    onClick={() => setScoutChoice((v) => ({ ...v, [s.id]: 'no' }))}
                  >
                    Can’t make it
                  </button>
                </span>
              </div>
              {scoutChoice[s.id] === 'yes' && tierPicker(`s:${s.id}`, 'scout')}
              {scoutChoice[s.id] === 'yes' && questionFields(`s:${s.id}`, 'scout')}
            </div>
          ))}
        </>
      )}

      {signup.audience !== 'scouts' && (
        <>
          <p className={styles.dayHead}>Adults</p>
          {adults.map((a) => (
            <div key={a.key} className={styles.personRow}>
              <div className={styles.personMain}>
                <span className={styles.personName}>
                  {a.name}
                  {/* A leader-roster adult has no relationship to a scout —
                      labelling the Scoutmaster "Parent" is just wrong. */}
                  <span className={styles.personSub}>
                    {a.relationship || (a.leaderCode ? 'Adult' : 'Parent')}
                  </span>
                </span>
                <span className={styles.seg}>
                  <button
                    type="button"
                    className={`${styles.segBtn} ${adultChoice[a.key] === 'full' ? styles.segYes : ''}`}
                    aria-pressed={adultChoice[a.key] === 'full'}
                    onClick={() => setAdultChoice((v) => ({ ...v, [a.key]: 'full' }))}
                  >
                    Attending
                  </button>
                  {signup.drivers_needed && (
                    <button
                      type="button"
                      className={`${styles.segBtn} ${adultChoice[a.key] === 'driver_only' ? styles.segDrv : ''}`}
                      aria-pressed={adultChoice[a.key] === 'driver_only'}
                      onClick={() => setAdultChoice((v) => ({ ...v, [a.key]: 'driver_only' }))}
                    >
                      Driver only
                    </button>
                  )}
                  <button
                    type="button"
                    className={`${styles.segBtn} ${adultChoice[a.key] === 'no' ? styles.segNo : ''}`}
                    aria-pressed={adultChoice[a.key] === 'no'}
                    onClick={() => setAdultChoice((v) => ({ ...v, [a.key]: 'no' }))}
                  >
                    Can’t make it
                  </button>
                </span>
              </div>

              {adultChoice[a.key] === 'driver_only' && (
                <p className={styles.drvNote}>
                  Not attending — transportation only. Excluded from the headcount and the two-deep
                  count, and <strong>never charged</strong>.
                </p>
              )}

              {adultChoice[a.key] === 'full' && tierPicker(`a:${a.key}`, 'adult')}
              {adultChoice[a.key] === 'full' && questionFields(`a:${a.key}`, 'adult')}

              {signup.drivers_needed &&
                (adultChoice[a.key] === 'full' || adultChoice[a.key] === 'driver_only') && (
                  <div className={styles.personExtra}>
                    <span className={styles.miniLabel}>Can you drive? Each leg counts separately.</span>
                    <label className={styles.chk}>
                      <input
                        type="checkbox"
                        checked={drives[a.key]?.out ?? false}
                        onChange={(e) =>
                          setDrives((v) => ({ ...v, [a.key]: { ...v[a.key], out: e.target.checked } }))
                        }
                      />
                      Drive there
                    </label>
                    <label className={styles.chk}>
                      <input
                        type="checkbox"
                        checked={drives[a.key]?.back ?? false}
                        onChange={(e) =>
                          setDrives((v) => ({ ...v, [a.key]: { ...v[a.key], back: e.target.checked } }))
                        }
                      />
                      Drive back
                    </label>
                    {(drives[a.key]?.out || drives[a.key]?.back) && (
                      <label className={styles.daysRow}>
                        <span className={styles.miniLabel}>Seats besides you</span>
                        <input
                          type="number"
                          min={1}
                          max={8}
                          value={drives[a.key]?.seats ?? 3}
                          onChange={(e) =>
                            setDrives((v) => ({
                              ...v,
                              [a.key]: { ...v[a.key], seats: Math.max(1, Number(e.target.value) || 1) }
                            }))
                          }
                          className={styles.numInput}
                        />
                      </label>
                    )}
                  </div>
                )}
            </div>
          ))}

          {/* Parent contact info is hard to collect ahead of time; this is often
              the first moment a second adult's details exist. Saved as a real
              scout_parents row so the roster improves instead of staying stale.

              Offered only to parties that HAVE a stored household: a new adult
              is written by add_parent_to_household, which needs a household id
              and raises HOUSEHOLD_HAS_NO_SCOUTS without one. Showing the field
              to a standalone adult would take their input and silently drop it
              on submit, since the action skips the add step when there's no
              household. Growing a committee-only household is a real want, but
              it needs its own design — see Plans/. */}
          {hasStoredHousehold && <div className={styles.addAdult}>
            {newAdults.map((na, i) => (
              <div key={na.tempId} className={styles.addAdultRow}>
                <input
                  className={styles.gateInput}
                  placeholder="Adult's full name"
                  value={na.name}
                  onChange={(e) =>
                    setNewAdults((v) => v.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                />
                <input
                  className={styles.gateInput}
                  placeholder="Email (optional)"
                  value={na.email}
                  onChange={(e) =>
                    setNewAdults((v) => v.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))
                  }
                />
                <input
                  className={styles.gateInput}
                  placeholder="Mom / Dad / Guardian"
                  value={na.relationship}
                  onChange={(e) =>
                    setNewAdults((v) =>
                      v.map((x, j) => (j === i ? { ...x, relationship: e.target.value } : x))
                    )
                  }
                />
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => setNewAdults((v) => v.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.addAdultBtn}
              onClick={() =>
                setNewAdults((v) => [
                  ...v,
                  { tempId: `n${v.length}${Date.now()}`, name: '', email: '', relationship: '' }
                ])
              }
            >
              + Add another adult
            </button>
            <p className={styles.pickerHint}>
              Missing a parent or guardian? Add them here — we’ll save them to your scout’s record so
              you don’t have to type it again next time.
            </p>
          </div>}
        </>
      )}

      {slots.length > 0 && (
        <div className={styles.guestBlock}>
          <p className={styles.dayHead}>{slotsTitle}</p>
          <p className={styles.gateLede}>{slotsIntro}</p>
          {attendingPeople().length === 0 && (
            <p className={styles.recapEmpty}>
              Mark who&rsquo;s attending above, then you can claim one of these.
            </p>
          )}
          {(
            <ul className={styles.slotList}>
              {slots.map((sl) => {
                const mine = claimersOf(sl.id);
                const filled = filledOf(sl);
                const full = sl.needed != null && filled >= sl.needed;
                return (
                  <li key={sl.id}>
                    <button
                      type="button"
                      className={styles.slotTrigger}
                      aria-expanded={openSlot === sl.id}
                      disabled={attendingPeople().length === 0}
                      onClick={() => setOpenSlot((v) => (v === sl.id ? null : sl.id))}
                    >
                      <span className={styles.slotTop}>
                        <span>
                          <strong>{sl.label}</strong>
                        </span>
                        <span className={styles.slotMeta}>
                          <span className={styles.count}>
                            {sl.needed == null
                              ? `${filled} signed up`
                              : full
                                ? `Covered (${sl.needed}/${sl.needed})`
                                : `${filled} of ${sl.needed}`}
                          </span>
                          {attendingPeople().length > 0 && (
                            <span className={styles.jobCue}>
                              {mine.length > 0 ? 'Change' : 'I can bring this'}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>

                    {mine.length > 0 && (
                      <div className={styles.claimerChips}>
                        {mine.map((k) => {
                          const p = attendingPeople().find((x) => x.key === k);
                          return (
                            <span key={k} className={styles.claimerChip}>
                              {(p?.name ?? k).split(' ')[0]}
                              <button
                                type="button"
                                className={styles.claimerX}
                                aria-label="Remove"
                                onClick={() => toggleClaim(sl.id, k)}
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {openSlot === sl.id && (
                      <div className={styles.memberPick}>
                        <p className={styles.pickPrompt}>Who&rsquo;s bringing it?</p>
                        <div className={styles.pickChips}>
                          {attendingPeople().map((p) => {
                            const on = mine.includes(p.key);
                            const elig =
                              sl.eligibility === 'both' ||
                              sl.eligibility === (p.kind === 'scout' ? 'scouts' : 'adults');
                            const blocked = !elig || (full && !on);
                            return (
                              <button
                                key={p.key}
                                type="button"
                                className={`${styles.pickChip} ${on ? styles.pickOn : ''} ${blocked ? styles.pickBlocked : ''}`}
                                disabled={blocked}
                                aria-pressed={on}
                                onClick={() => toggleClaim(sl.id, p.key)}
                              >
                                <span className={styles.pickName}>{p.name}</span>
                                <span className={styles.pickSub}>
                                  {!elig
                                    ? sl.eligibility === 'adults'
                                      ? 'Adults only'
                                      : 'Scouts only'
                                    : full && !on
                                      ? 'Already covered'
                                      : ''}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {signup.allow_guests && (
        <div className={styles.guestBlock}>
          <p className={styles.dayHead}>Guests</p>
          <p className={styles.gateLede}>
            {signup.guest_prompt ?? 'Friends and family joining — how many? We don’t need their names.'}
          </p>
          <div className={styles.guestGrid}>
            <label className={styles.gateLabel}>
              How many guests?
              <input
                type="number"
                min={0}
                max={200}
                value={guests}
                onChange={(e) => setGuests(Math.max(0, Number(e.target.value) || 0))}
                className={styles.gateInput}
              />
            </label>
            <label className={styles.gateLabel}>
              Who are they? (optional)
              <input
                type="text"
                value={guestNote}
                onChange={(e) => setGuestNote(e.target.value)}
                placeholder="e.g. grandparents, 2 aunts, neighbors"
                className={styles.gateInput}
              />
            </label>
          </div>
        </div>
      )}

      {signup.notes_prompt && (
        <div className={styles.guestBlock}>
          <p className={styles.dayHead}>Notes</p>
          <label className={styles.gateLabel}>
            {signup.notes_prompt}
            <textarea
              className={styles.notesArea}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </label>
        </div>
      )}

      {prices.length > 0 && (
        <div className={styles.recap} aria-live="polite">
          <p className={styles.dayHead}>Your household total</p>
          {lines.length === 0 ? (
            <p className={styles.recapEmpty}>
              Mark someone “Yes” and the math shows up here — nothing is charged online.
            </p>
          ) : (
            <>
              <ul className={styles.recapList}>
                {lines.map((l, i) => (
                  <li key={i} className={styles.owedLine}>
                    <span>
                      <strong>{l.name}</strong> — {l.label}
                      {l.math && <em className={styles.recapJobs}>{l.math}</em>}
                    </span>
                    <span className={l.amount === 0 ? styles.owedZero : styles.owedAmt}>
                      {money(l.amount)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className={styles.owedTotal}>
                <span>Total owed</span>
                <span>{money(total)}</span>
              </p>
              {signup.payment_instructions && (
                <p className={styles.payNote}>{signup.payment_instructions}</p>
              )}
            </>
          )}
        </div>
      )}

      <div className={styles.formActions}>
        <button type="submit" className={styles.gateBtn} disabled={!anyChoice}>
          {existing.length > 0 ? 'Save changes' : 'Submit family signup'}
        </button>
      </div>

      {existing.length > 0 && (
        <p className={styles.cancelRow}>
          <button type="submit" formAction={cancelAction} className={styles.linkBtn}>
            Cancel our whole signup
          </button>
        </p>
      )}
    </form>
  );
}
