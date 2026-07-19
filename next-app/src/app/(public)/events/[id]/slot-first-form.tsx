'use client';

import { useMemo, useState } from 'react';
import type { SignupSlot } from '@/lib/event-signup';
import type { Household } from '@/lib/households';
import styles from './event-detail.module.css';

/*
 * SLOT-FIRST signup — organized by the JOB, not the person.
 *
 * For fundraisers (Pancake Breakfast, Rummage Sale) the work is the unit of
 * signup: listing every slot under every family member repeats an 8-row grid
 * per person. Here each job appears once with live coverage, and "sign up"
 * opens a picker of eligible household members. Claiming a job IS the signup,
 * which is why these events run with attendance off.
 *
 * Storage is unchanged: claims still resolve to per-person entries, so the
 * roster and confirmation stay person-indexed. Only the input surface flips.
 */

interface Person {
  key: string;
  kind: 'scout' | 'adult';
  name: string;
  sub: string;
  scoutId?: string;
  parentId?: number;
  adultName?: string;
}

export interface ExistingClaim {
  slotId: number;
  personKey: string;
}

export default function SlotFirstForm({
  eventId,
  signupId,
  household,
  slots,
  allowGuests,
  guestPrompt,
  existingClaims,
  submitAction,
  cancelAction,
  hasExisting
}: {
  eventId: number;
  signupId: number;
  household: Household;
  slots: SignupSlot[];
  allowGuests: boolean;
  guestPrompt: string | null;
  existingClaims: ExistingClaim[];
  submitAction: (fd: FormData) => void;
  cancelAction: (fd: FormData) => void;
  hasExisting: boolean;
}) {
  const people = useMemo<Person[]>(
    () => [
      ...household.scouts.map((s, i) => ({
        key: `s${i}`,
        kind: 'scout' as const,
        name: s.displayName,
        sub: 'Scout',
        scoutId: s.id
      })),
      ...household.adults.map((a, i) => ({
        key: `a${i}`,
        kind: 'adult' as const,
        name: a.name,
        sub: a.relationship || 'Parent',
        parentId: a.id
      }))
    ],
    [household]
  );

  const [claims, setClaims] = useState<Record<number, string[]>>(() => {
    const init: Record<number, string[]> = {};
    for (const c of existingClaims) init[c.slotId] = [...(init[c.slotId] ?? []), c.personKey];
    return init;
  });
  const [open, setOpen] = useState<number | null>(null);
  const [fullNote, setFullNote] = useState<number | null>(null);
  const [guests, setGuests] = useState(0);
  const [guestNote, setGuestNote] = useState('');

  const claimersOf = (slotId: number) => claims[slotId] ?? [];
  const filledOf = (s: SignupSlot) => {
    // Base coverage excludes this household's existing claims so re-rendering
    // our own picks doesn't double-count them.
    const mineExisting = existingClaims.filter((c) => c.slotId === s.id).length;
    return s.filled - mineExisting + claimersOf(s.id).length;
  };
  const isFull = (s: SignupSlot) => s.needed != null && filledOf(s) >= s.needed;
  const eligible = (p: Person, s: SignupSlot) =>
    s.eligibility === 'both' ||
    (s.eligibility === 'scouts' ? p.kind === 'scout' : p.kind === 'adult');

  const toggle = (slotId: number, personKey: string) => {
    setClaims((prev) => {
      const cur = prev[slotId] ?? [];
      return {
        ...prev,
        [slotId]: cur.includes(personKey)
          ? cur.filter((k) => k !== personKey)
          : [...cur, personKey]
      };
    });
  };

  // Group by day so multi-day events read as a schedule.
  const groups = useMemo(() => {
    const out: { day: string; items: SignupSlot[] }[] = [];
    for (const s of slots) {
      const label = s.slot_date
        ? new Date(`${s.slot_date}T12:00:00`).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric'
          })
        : 'Anytime before the event';
      const g = out.find((x) => x.day === label);
      if (g) g.items.push(s);
      else out.push({ day: label, items: [s] });
    }
    return out;
  }, [slots]);

  // Only people who actually hold a claim become entries. Someone whose claims
  // are all donation tasks isn't attending — that's a contributor, derived
  // rather than asked for.
  const entries = useMemo(() => {
    const claimedBy = new Map<string, SignupSlot[]>();
    for (const [slotId, keys] of Object.entries(claims)) {
      const slot = slots.find((s) => s.id === Number(slotId));
      if (!slot) continue;
      for (const k of keys) claimedBy.set(k, [...(claimedBy.get(k) ?? []), slot]);
    }
    return people
      .filter((p) => (claimedBy.get(p.key) ?? []).length > 0)
      .map((p) => {
        const mine = claimedBy.get(p.key)!;
        const donationOnly = mine.every((s) => !s.attendance_required);
        return {
          key: p.key,
          person_kind: p.kind,
          scout_id: p.scoutId ?? null,
          scout_parent_id: p.parentId ?? null,
          adult_name: p.adultName ?? null,
          status: 'yes',
          participation: donationOnly ? 'contributor' : 'full',
          guest_count: p.key === people[0]?.key ? guests : 0,
          guest_note: p.key === people[0]?.key ? guestNote : null
        };
      });
  }, [claims, people, slots, guests, guestNote]);

  const claimsForSubmit = useMemo(() => {
    const byPerson: Record<string, number[]> = {};
    for (const [slotId, keys] of Object.entries(claims)) {
      for (const k of keys) byPerson[k] = [...(byPerson[k] ?? []), Number(slotId)];
    }
    return byPerson;
  }, [claims]);

  const nothingClaimed = entries.length === 0;

  return (
    <form action={submitAction} className={styles.signupForm}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="signupId" value={signupId} />
      <input type="hidden" name="householdKey" value={household.key} />
      <input type="hidden" name="entries" value={JSON.stringify(entries)} />
      <input type="hidden" name="slotClaims" value={JSON.stringify(claimsForSubmit)} />

      <p className={styles.formLede}>
        Pick a job and choose who’s doing it — one person or several. Claiming a job{' '}
        <em>is</em> your signup; there’s no separate RSVP.
      </p>

      {groups.map((g) => (
        <div key={g.day} className={styles.dayGroup}>
          <p className={styles.dayHead}>{g.day}</p>
          <ul className={styles.slotList}>
            {g.items.map((s) => {
              const mine = claimersOf(s.id);
              const full = isFull(s);
              const lockedOut = full && mine.length === 0;
              const pct = s.needed
                ? Math.min(100, Math.round((filledOf(s) / s.needed) * 100))
                : 0;
              return (
                <li key={s.id} className={lockedOut ? styles.slotFull : undefined}>
                  <button
                    type="button"
                    className={styles.slotTrigger}
                    aria-expanded={open === s.id}
                    onClick={() => {
                      if (lockedOut) {
                        setFullNote(s.id);
                        window.setTimeout(() => setFullNote((v) => (v === s.id ? null : v)), 5000);
                        return;
                      }
                      setOpen((v) => (v === s.id ? null : s.id));
                    }}
                  >
                    <span className={styles.slotTop}>
                      <span>
                        <strong>{s.label}</strong>
                        <span className={styles.slotWhen}>
                          {s.starts_at ? `${s.starts_at.slice(0, 5)}–${s.ends_at?.slice(0, 5)}` : 'Untimed'}
                          {!s.attendance_required && ' · no attendance needed'}
                        </span>
                      </span>
                      <span className={styles.slotMeta}>
                        <span className={styles.elig}>
                          {s.eligibility === 'both'
                            ? 'Everyone'
                            : s.eligibility === 'scouts'
                              ? 'Scouts'
                              : 'Adults'}
                        </span>
                        <span className={styles.count}>
                          {s.needed == null
                            ? `${filledOf(s)} signed up`
                            : full
                              ? `Full (${s.needed}/${s.needed})`
                              : `${filledOf(s)} of ${s.needed} — ${s.needed - filledOf(s)} more needed`}
                        </span>
                      </span>
                    </span>
                    <span className={styles.bar}>
                      <span style={{ width: `${pct}%` }} />
                    </span>
                  </button>

                  {fullNote === s.id && (
                    <p className={styles.fullNote} role="status">
                      <strong>This job is full.</strong> All {s.needed} spots are taken — pick
                      another job, or ask a leader if you think there’s room.
                    </p>
                  )}

                  {mine.length > 0 && (
                    <div className={styles.claimerChips}>
                      {mine.map((k) => {
                        const p = people.find((x) => x.key === k);
                        if (!p) return null;
                        return (
                          <span key={k} className={styles.claimerChip}>
                            {p.name.split(' ')[0]}
                            <button
                              type="button"
                              className={styles.claimerX}
                              aria-label={`Remove ${p.name}`}
                              onClick={() => toggle(s.id, k)}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {open === s.id && (
                    <div className={styles.memberPick}>
                      <p className={styles.pickPrompt}>
                        Who from the {household.label} family is doing this?
                      </p>
                      <div className={styles.pickChips}>
                        {people.map((p) => {
                          const on = mine.includes(p.key);
                          const ok = eligible(p, s);
                          const blocked = !ok || (full && !on);
                          return (
                            <button
                              key={p.key}
                              type="button"
                              className={`${styles.pickChip} ${on ? styles.pickOn : ''} ${blocked ? styles.pickBlocked : ''}`}
                              disabled={blocked}
                              aria-pressed={on}
                              onClick={() => toggle(s.id, p.key)}
                            >
                              <span className={styles.pickName}>{p.name}</span>
                              <span className={styles.pickSub}>
                                {!ok
                                  ? s.eligibility === 'adults'
                                    ? 'Adults only'
                                    : 'Scouts only'
                                  : full && !on
                                    ? 'This job is full'
                                    : p.sub}
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
        </div>
      ))}

      {allowGuests && (
        <div className={styles.guestBlock}>
          <p className={styles.dayHead}>Guests coming along</p>
          <p className={styles.gateLede}>
            {guestPrompt ?? 'Friends and family joining — how many, so we can plan? We don’t need their names.'}
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

      <div className={styles.recap}>
        <p className={styles.dayHead}>Your household’s jobs</p>
        {nothingClaimed ? (
          <p className={styles.recapEmpty}>
            No jobs claimed yet — pick one above and say who’s doing it.
          </p>
        ) : (
          <ul className={styles.recapList}>
            {entries.map((e) => {
              const p = people.find((x) => x.key === e.key)!;
              const mine = Object.entries(claims)
                .filter(([, keys]) => keys.includes(e.key))
                .map(([sid]) => slots.find((s) => s.id === Number(sid))?.label)
                .filter(Boolean);
              return (
                <li key={e.key}>
                  <strong>{p.name}</strong>{' '}
                  <em>({e.participation === 'contributor' ? 'Donating — not attending' : 'Helping'})</em>
                  <span className={styles.recapJobs}>{mine.join(' · ')}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={styles.formActions}>
        <button type="submit" className={styles.gateBtn} disabled={nothingClaimed}>
          {hasExisting ? 'Save changes' : 'Submit family signup'}
        </button>
      </div>

      {hasExisting && (
        <p className={styles.cancelRow}>
          <button type="submit" formAction={cancelAction} className={styles.linkBtn}>
            Cancel our whole signup
          </button>
        </p>
      )}
    </form>
  );
}
