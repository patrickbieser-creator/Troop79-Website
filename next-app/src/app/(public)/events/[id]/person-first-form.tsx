'use client';

import { GuestRowsEditor, GuestCountField, type GuestRowValue } from './guest-rows';
import { SavingOverlay, intentOf, type SaveIntent } from './save-feedback';
import { useMemo, useState } from 'react';
import type {
  EventPrice,
  EventSignup,
  HouseholdEntry,
  PartyMembership,
  PublicGroupSet,
  SignupQuestion,
  SignupSlot,
  HouseholdGuest
} from '@/lib/event-signup';
import { guestHostKey } from '@/lib/guest-payload';
import type { Household, HouseholdAdult } from '@/lib/households';
import {
  defaultSeats,
  LEG_LABEL,
  RIDE_STATUSES,
  RIDE_STATUS_LABEL,
  type Leg,
  type RideStatus
} from '@/lib/transport';
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
  groupSets = [],
  existingMemberships = [],
  householdGuests = [],
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
  /** Sets the family may pick a group in (Plans/Event-Logistics.md §B) —
   *  "Tent preference". Blank = the leader decides. */
  groupSets?: PublicGroupSet[];
  existingMemberships?: PartyMembership[];
  /** The household's guests on record (Plans/Guests-As-People.md) — offered
   *  as one-click picks in named mode. */
  householdGuests?: HouseholdGuest[];
  submitAction: (fd: FormData) => void;
  cancelAction: (fd: FormData) => void;
}) {
  const slotsTitle = signup.slots_title ?? 'What can you bring?';

  const scouts = household.scouts;
  const adults = household.adults;
  /** A stored `households` row, as opposed to the `scout:<id>` / `leader:<code>`
   *  parties that stand alone. Gates anything that needs a household id. */
  const hasStoredHousehold = /^\d+$/.test(household.key);

  /* person_id is the whole match — the scout_id / scout_parent_id /
     leader_code fallbacks went with their columns (D-066). */
  const priorScout = (s: { id: string; personId: number | null }) =>
    existing.find((e) => e.person_id === s.personId);
  const priorAdult = (a: HouseholdAdult) => existing.find((e) => e.person_id === a.personId);

  const [scoutChoice, setScoutChoice] = useState<Record<string, ScoutChoice>>(() =>
    Object.fromEntries(
      scouts.map((s) => {
        const p = priorScout(s);
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
    for (const s of scouts) init[`s:${s.id}`] = priorScout(s)?.price_id ?? null;
    for (const a of adults) init[`a:${a.key}`] = priorAdult(a)?.price_id ?? null;
    return init;
  });
  const [days, setDays] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const s of scouts) init[`s:${s.id}`] = priorScout(s)?.days ?? 1;
    for (const a of adults) init[`a:${a.key}`] = priorAdult(a)?.days ?? 1;
    return init;
  });
  // Driving, per adult: legs + seats INCLUDING the driver (Plans/Event-Logistics.md
  // §A). Prefilled from the prior entry, else the capacity this adult last
  // offered at any event (people.default_vehicle_seats), else an ordinary car.
  const [drives, setDrives] = useState<Record<string, { out: boolean; back: boolean; seats: number }>>(
    () =>
      Object.fromEntries(
        adults.map((a) => {
          const p = priorAdult(a);
          return [
            a.key,
            {
              out: p?.drives_out ?? false,
              back: p?.drives_back ?? false,
              seats: defaultSeats(p?.vehicle_seats_out ?? p?.vehicle_seats_back ?? a.defaultVehicleSeats)
            }
          ];
        })
      )
  );
  // Ride status per person per leg for anyone NOT driving that leg. Defaults
  // to "needs a ride" (Patrick, 2026-08-22) — the other three happen often
  // enough that every one is offered.
  const [rides, setRides] = useState<Record<string, Record<Leg, RideStatus>>>(() => {
    const init: Record<string, Record<Leg, RideStatus>> = {};
    for (const s of scouts) {
      const p = priorScout(s);
      init[`s:${s.id}`] = { out: p?.ride_out ?? 'needs_ride', back: p?.ride_back ?? 'needs_ride' };
    }
    for (const a of adults) {
      const p = priorAdult(a);
      init[`a:${a.key}`] = { out: p?.ride_out ?? 'needs_ride', back: p?.ride_back ?? 'needs_ride' };
    }
    return init;
  });
  const setRide = (key: string, leg: Leg, value: RideStatus) =>
    setRides((v) => ({ ...v, [key]: { ...(v[key] ?? { out: 'needs_ride', back: 'needs_ride' }), [leg]: value } }));

  // Self-select placements: picks[personKey][setId] = groupId | '' (leader decides).
  // Prefilled from the party's existing memberships so an edit shows the tent
  // they already chose (or a leader already put them in).
  const [picks, setPicks] = useState<Record<string, Record<number, number | ''>>>(() => {
    const init: Record<string, Record<number, number | ''>> = {};
    const keyOfEntry = (e: HouseholdEntry) => {
      const sc = e.person_kind === 'scout' ? scouts.find((s) => s.personId === e.person_id) : null;
      if (sc) return `s:${sc.id}`;
      const ad = e.person_kind === 'adult' ? adults.find((a) => a.personId === e.person_id) : null;
      return ad ? `a:${ad.key}` : null;
    };
    const keyByEntryId = new Map(existing.map((e) => [e.id, keyOfEntry(e)]));
    for (const m of existingMemberships) {
      const key = keyByEntryId.get(m.entryId);
      if (!key) continue;
      init[key] = { ...(init[key] ?? {}), [m.setId]: m.groupId };
    }
    return init;
  });
  const setPick = (key: string, setId: number, groupId: number | '') =>
    setPicks((v) => ({ ...v, [key]: { ...(v[key] ?? {}), [setId]: groupId } }));

  /** "Tent preference" pickers — one select per self-select set, for an
   *  attending person. A full group is offered only if it's the one they're
   *  already in. Blank = the leader places them. */
  const pickFields = (key: string, name: string) => {
    if (groupSets.length === 0) return null;
    return (
      <div className={styles.rideRow}>
        {groupSets.map((gs) => {
          const current = picks[key]?.[gs.id] ?? '';
          return (
            <label key={gs.id} className={styles.rideField}>
              <span className={styles.rideLeg}>{gs.label}</span>
              <select
                className={styles.rideSelect}
                aria-label={`${name} — ${gs.label}`}
                value={current}
                onChange={(e) => setPick(key, gs.id, e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">No preference — leaders will place me</option>
                {gs.groups.map((g) => {
                  const full = g.capacity != null && g.filled >= g.capacity && g.id !== current;
                  return (
                    <option key={g.id} value={g.id} disabled={full}>
                      {g.name}
                      {g.capacity != null ? ` (${g.filled}/${g.capacity}${full ? ' full' : ''})` : ''}
                    </option>
                  );
                })}
              </select>
            </label>
          );
        })}
      </div>
    );
  };
  // Guests (Plans/Guests-As-People.md). Named mode: rows seeded from the
  // party's existing guest entries (a guest row is one with a host) so an
  // edit shows who's already listed — each carries its people id, so saving
  // again re-picks the same person. Count mode: the number + note the host
  // entry carries.
  const [guestRows, setGuestRows] = useState<GuestRowValue[]>(() =>
    existing
      .filter((e) => e.host_entry_id != null)
      .map((e) => ({
        personId: e.person_id,
        name: e.guest_name ?? '',
        cls: e.participant_class as GuestRowValue['cls'],
        phone: householdGuests.find((g) => g.personId === e.person_id)?.phone ?? '',
        // A saved guest marked 'no' comes back toggled to Can't make it — the
        // same thing a member's row does.
        attending: e.status === 'yes' || e.status === 'waitlist'
      }))
  );
  // "Saving changes…" overlay from the moment the form submits (save-feedback.tsx).
  const [saving, setSaving] = useState<SaveIntent | null>(null);
  const [guestCount, setGuestCount] = useState<{ count: number; note: string }>(() => {
    const host = existing.find((e) => e.guest_count > 0);
    return { count: host?.guest_count ?? 0, note: host?.guest_note ?? '' };
  });
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
      // Both halves key off person_id. The scout half used to read e.scout_id
      // directly; that column is gone (D-066), so a scout is resolved through
      // the household list exactly as an adult already was.
      const adult = e.person_kind === 'adult' ? adults.find((a) => a.personId === e.person_id) : null;
      const scout = e.person_kind === 'scout' ? scouts.find((s) => s.personId === e.person_id) : null;
      const key = scout ? `s:${scout.id}` : adult ? `a:${adult.key}` : null;
      if (!key) continue;
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
    for (const s of scouts) {
      const c = scoutChoice[s.id];
      if (!c) continue;
      const t = c === 'yes' ? chosenTier(`s:${s.id}`, 'scout') : null;
      out.push({
        key: `s:${s.id}`,
        person_kind: 'scout',
        scout_id: s.id,
        person_id: s.personId,
        status: c,
        participation: 'full',
        price_id: t?.id ?? null,
        days: t?.per === 'day' ? days[`s:${s.id}`] : null,
        guest_count: 0,
        notes: notes || null,
        ride_out: signup.drivers_needed ? (rides[`s:${s.id}`]?.out ?? 'needs_ride') : null,
        ride_back: signup.drivers_needed ? (rides[`s:${s.id}`]?.back ?? 'needs_ride') : null,
        answers: c === 'yes' ? answerArr(`s:${s.id}`, 'scout') : []
      });
    }
    for (const a of adults) {
      const c = adultChoice[a.key];
      if (!c || c === 'no') continue;
      const attending = c === 'full';
      const t = attending ? chosenTier(`a:${a.key}`, 'adult') : null;
      const d = drives[a.key] ?? { out: false, back: false, seats: 3 };
      out.push({
        key: `a:${a.key}`,
        person_kind: 'adult',
        // person_id is the sole identity sent now (signup_entries_person_uniq
        // + the RPC's party-membership check) — scout_parent_id/leader_code
        // are no longer needed since person_id is always resolvable here.
        person_id: a.personId,
        status: 'yes',
        participation: attending ? 'full' : 'driver_only',
        price_id: t?.id ?? null,
        days: t?.per === 'day' ? days[`a:${a.key}`] : null,
        drives_out: d.out,
        drives_back: d.back,
        // Seats INCLUDING the driver; the DB derives the legacy besides-the-
        // driver column from this. A leg not driven carries a ride status.
        vehicle_seats_out: d.out ? d.seats : null,
        vehicle_seats_back: d.back ? d.seats : null,
        ride_out: d.out || !signup.drivers_needed ? null : (rides[`a:${a.key}`]?.out ?? 'needs_ride'),
        ride_back: d.back || !signup.drivers_needed ? null : (rides[`a:${a.key}`]?.back ?? 'needs_ride'),
        // Legacy count stays 0 — guests are NAMED ROWS now (hidden `guests`
        // field, written by the submit action under this party's host entry).
        guest_count: 0,
        guest_note: null,
        notes: notes || null,
        answers: attending ? answerArr(`a:${a.key}`, 'adult') : []
      });
    }
    // Count mode: "+N guests" rides on the host entry — the first attending
    // member, an adult when there is one (the same rule the named rows use
    // for their host). Named rows travel in the `guests` field instead.
    if (signup.guest_mode === 'count' && guestCount.count > 0) {
      const hostKey = guestHostKey(out);
      const host = hostKey ? out.find((e) => e.key === hostKey) : null;
      if (host) {
        host.guest_count = guestCount.count;
        host.guest_note = guestCount.note.trim() || null;
      }
    }
    return out;
  }, [scoutChoice, adultChoice, tier, days, drives, rides, notes, scouts, adults, signup.drivers_needed, signup.guest_mode, guestCount]);

  const anyChoice = entries.length > 0;

  /** Per-leg ride status for an attending person, only for legs they don't
   *  drive. Shown only when the event tracks transportation. */
  const rideFields = (key: string, name: string, drivenLegs: { out: boolean; back: boolean }) => {
    if (!signup.drivers_needed) return null;
    const legs = (['out', 'back'] as Leg[]).filter((l) => !drivenLegs[l]);
    if (legs.length === 0) return null;
    return (
      <div className={styles.rideRow}>
        <span className={styles.miniLabel}>Getting there &amp; back</span>
        {legs.map((leg) => (
          <label key={leg} className={styles.rideField}>
            <span className={styles.rideLeg}>{LEG_LABEL[leg]}</span>
            <select
              className={styles.rideSelect}
              aria-label={`${name} — ${LEG_LABEL[leg].toLowerCase()}`}
              value={rides[key]?.[leg] ?? 'needs_ride'}
              onChange={(e) => setRide(key, leg, e.target.value as RideStatus)}
            >
              {RIDE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {RIDE_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  };

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
    <form action={submitAction} className={styles.signupForm} onSubmit={(e) => setSaving(intentOf(e))}>
      <SavingOverlay intent={saving} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="signupId" value={signup.id} />
      <input type="hidden" name="householdKey" value={household.key} />
      <input type="hidden" name="entries" value={JSON.stringify(entries)} />
      <input type="hidden" name="placements" value={JSON.stringify(picks)} />
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
              {scoutChoice[s.id] === 'yes' &&
                rideFields(`s:${s.id}`, s.displayName, { out: false, back: false })}
              {scoutChoice[s.id] === 'yes' && pickFields(`s:${s.id}`, s.displayName)}
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
                        <span className={styles.miniLabel}>Seats in your vehicle, including you</span>
                        <input
                          type="number"
                          min={1}
                          max={15}
                          value={drives[a.key]?.seats ?? 4}
                          onChange={(e) =>
                            setDrives((v) => ({
                              ...v,
                              [a.key]: { ...v[a.key], seats: Math.max(1, Number(e.target.value) || 1) }
                            }))
                          }
                          className={styles.numInput}
                        />
                        <span className={styles.dayMath}>
                          {Math.max(0, (drives[a.key]?.seats ?? 4) - 1)} for riders
                        </span>
                      </label>
                    )}
                    {adultChoice[a.key] === 'full' &&
                      rideFields(`a:${a.key}`, a.name, {
                        out: drives[a.key]?.out ?? false,
                        back: drives[a.key]?.back ?? false
                      })}
                  </div>
                )}
              {adultChoice[a.key] === 'full' && pickFields(`a:${a.key}`, a.name)}
            </div>
          ))}

          {/* Parent contact info is hard to collect ahead of time; this is often
              the first moment a second adult's details exist. Saved as a real
              person so the roster improves instead of staying stale.

              Offered only to parties that HAVE a stored household: a new adult
              is written by add_parent_to_household, which needs a household id.
              (It no longer needs that household to contain a SCOUT — that
              requirement went with scout_parents in D-066.) Showing the field
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
              + Add another parent or guardian
            </button>
            <p className={styles.pickerHint}>
              Missing a parent or guardian from the list above? Add them here — we’ll save them to your
              scout’s record so you don’t have to type it again next time. (Friends, siblings and other
              guests go under Guests, below.)
            </p>
          </div>}
        </>
      )}

      {/* Guests sit with the people, not with the jobs (Patrick, 2026-08-23:
          "display guest in the same style as scouts and adults at the top"). */}
      {signup.guest_mode === 'named' && (
        <GuestRowsEditor
          guests={guestRows}
          onChange={setGuestRows}
          prompt={signup.guest_prompt}
          previousGuests={householdGuests}
        />
      )}
      {signup.guest_mode === 'count' && (
        <GuestCountField
          count={guestCount.count}
          note={guestCount.note}
          onChange={setGuestCount}
          prompt={signup.guest_prompt}
        />
      )}

      {slots.length > 0 && (
        <div className={styles.guestBlock}>
          <p className={styles.dayHead}>{slotsTitle}</p>
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
                      {/* Full-width row under the header — see slot-first-form
                          for why this can't live inside the title block. */}
                      {sl.description && (
                        <span className={styles.slotDesc}>{sl.description}</span>
                      )}
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
          <button type="submit" formAction={cancelAction} className={styles.linkBtn} data-intent="cancel">
            Cancel our whole signup
          </button>
        </p>
      )}
    </form>
  );
}
