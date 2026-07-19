'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SignupSlot } from '@/lib/event-signup';
import type { Household } from '@/lib/households';
import { formatTimeOfDay } from '@/lib/calendar-shared';
import styles from './event-detail.module.css';

/*
 * THE JOB BOARD — one list, not two.
 *
 * This list used to render twice: a public read-only copy up top, then an
 * identical interactive copy inside the signup form below. With 30+ jobs on a
 * rummage sale that meant scrolling past every job to reach the same jobs
 * again. Now there is a single list, and the gate comes to the job you
 * clicked instead of making you hunt for it.
 *
 * Three interaction states, all anchored at the row you clicked:
 *   anon         → inline "sign in with the troop password" panel
 *   no-household → inline "find your family" search
 *   ready        → the member picker
 *
 * When not ready there is no outer <form>, so the inline gate can be its own
 * form (nested forms are invalid HTML and silently break submission).
 */

interface Person {
  key: string;
  kind: 'scout' | 'adult';
  name: string;
  sub: string;
  scoutId?: string;
  parentId?: number;
}

export interface ExistingClaim {
  slotId: number;
  personKey: string;
}

export type GateState = 'anon' | 'no-household' | 'ready';

export default function SlotFirstForm({
  eventId,
  signupId,
  household,
  households,
  slots,
  allowGuests,
  guestPrompt,
  slotsIntro,
  existingClaims,
  submitAction,
  cancelAction,
  gateAction,
  signOutAction,
  hasExisting,
  gateState,
  isFamilySession,
  gateError,
  gateConfigured
}: {
  eventId: number;
  signupId: number;
  household: Household | null;
  households: Household[];
  slots: SignupSlot[];
  allowGuests: boolean;
  guestPrompt: string | null;
  slotsIntro: string | null;
  existingClaims: ExistingClaim[];
  submitAction: (fd: FormData) => void;
  cancelAction: (fd: FormData) => void;
  gateAction: (fd: FormData) => void;
  signOutAction: (fd: FormData) => void;
  hasExisting: boolean;
  gateState: GateState;
  isFamilySession: boolean;
  gateError?: string;
  gateConfigured: boolean;
}) {
  const router = useRouter();
  const ready = gateState === 'ready' && household !== null;

  const people = useMemo<Person[]>(
    () =>
      household
        ? [
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
          ]
        : [],
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
  const [query, setQuery] = useState('');

  const claimersOf = (slotId: number) => claims[slotId] ?? [];
  const filledOf = (s: SignupSlot) => {
    const mineExisting = existingClaims.filter((c) => c.slotId === s.id).length;
    return s.filled - mineExisting + claimersOf(s.id).length;
  };
  const isFull = (s: SignupSlot) => s.needed != null && filledOf(s) >= s.needed;
  const eligible = (p: Person, s: SignupSlot) =>
    s.eligibility === 'both' ||
    (s.eligibility === 'scouts' ? p.kind === 'scout' : p.kind === 'adult');

  const toggle = (slotId: number, personKey: string) =>
    setClaims((prev) => {
      const cur = prev[slotId] ?? [];
      return {
        ...prev,
        [slotId]: cur.includes(personKey)
          ? cur.filter((k) => k !== personKey)
          : [...cur, personKey]
      };
    });

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

  const entries = useMemo(() => {
    if (!ready) return [];
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
          status: 'yes',
          participation: donationOnly ? 'contributor' : 'full',
          guest_count: p.key === people[0]?.key ? guests : 0,
          guest_note: p.key === people[0]?.key ? guestNote || null : null
        };
      });
  }, [claims, people, slots, guests, guestNote, ready]);

  const claimsForSubmit = useMemo(() => {
    const byPerson: Record<string, number[]> = {};
    for (const [slotId, keys] of Object.entries(claims)) {
      for (const k of keys) byPerson[k] = [...(byPerson[k] ?? []), Number(slotId)];
    }
    return byPerson;
  }, [claims]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return households
      .flatMap((h) => h.scouts.map((s) => ({ household: h, scout: s })))
      .filter(({ scout, household: hh }) =>
        `${scout.displayName} ${hh.label}`.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [query, households]);

  /** What opens under a job row, depending on how far in the visitor is. */
  const rowPanel = (sl: SignupSlot) => {
    if (gateState === 'anon') {
      return (
        <div className={styles.memberPick}>
          <p className={styles.pickPrompt}>Sign in to claim “{sl.label}”</p>
          {!gateConfigured ? (
            <p className={styles.gateLede}>
              The family signup gate isn’t configured on this server yet.
            </p>
          ) : (
            <form action={gateAction} className={styles.inlineGate}>
              <input type="hidden" name="next" value={`/events/${eventId}`} />
              <p className={styles.gateLede}>
                One shared password for the whole troop — it’s in the Bugle each week, or ask any
                leader. You’ll only enter it once on this device.
              </p>
              <div className={styles.gateRow}>
                <input
                  name="password"
                  type="password"
                  autoComplete="off"
                  className={styles.gateInput}
                  placeholder="Troop password"
                  aria-label="Troop password"
                />
                <button type="submit" className={styles.gateBtn}>
                  Sign in
                </button>
              </div>
              {gateError === 'bad-password' && (
                <p className={styles.gateErr}>That password didn’t match. Try again.</p>
              )}
              {gateError === 'missing' && (
                <p className={styles.gateErr}>Please enter the troop password.</p>
              )}
            </form>
          )}
        </div>
      );
    }

    if (gateState === 'no-household') {
      return (
        <div className={styles.memberPick}>
          <p className={styles.pickPrompt}>Which family is signing up for “{sl.label}”?</p>
          <input
            type="search"
            className={styles.gateInput}
            placeholder="Start typing your scout’s name…"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Your scout’s name"
          />
          {query.trim().length >= 2 && (
            <ul className={styles.pickerResults}>
              {matches.length === 0 && (
                <li className={styles.pickerNone}>
                  No scout by that name — check the spelling, or ask a leader.
                </li>
              )}
              {matches.map(({ household: hh, scout }) => (
                <li key={scout.id}>
                  <button
                    type="button"
                    className={styles.pickerBtn}
                    onClick={() =>
                      router.push(`/events/${eventId}?household=${encodeURIComponent(hh.key)}`)
                    }
                  >
                    <span className={styles.pickerName}>{scout.displayName}</span>
                    <span className={styles.pickerMeta}>
                      {hh.scouts.length > 1
                        ? `${hh.label} household · ${hh.scouts.length} scouts`
                        : `${hh.label} household`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }

    const full = isFull(sl);
    const mine = claimersOf(sl.id);
    return (
      <div className={styles.memberPick}>
        <p className={styles.pickPrompt}>Who from the {household!.label} family is doing this?</p>
        <div className={styles.pickChips}>
          {people.map((p) => {
            const on = mine.includes(p.key);
            const ok = eligible(p, sl);
            const blocked = !ok || (full && !on);
            return (
              <button
                key={p.key}
                type="button"
                className={`${styles.pickChip} ${on ? styles.pickOn : ''} ${blocked ? styles.pickBlocked : ''}`}
                disabled={blocked}
                aria-pressed={on}
                onClick={() => toggle(sl.id, p.key)}
              >
                <span className={styles.pickName}>{p.name}</span>
                <span className={styles.pickSub}>
                  {!ok
                    ? sl.eligibility === 'adults'
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
    );
  };

  const jobList = (
    <>
      {groups.map((g) => (
        <div key={g.day} className={styles.dayGroup}>
          <p className={styles.dayHead}>{g.day}</p>
          <ul className={styles.slotList}>
            {g.items.map((sl) => {
              const mine = claimersOf(sl.id);
              const full = isFull(sl);
              const lockedOut = full && mine.length === 0 && ready;
              const pct = sl.needed
                ? Math.min(100, Math.round((filledOf(sl) / sl.needed) * 100))
                : 0;
              return (
                <li key={sl.id} className={lockedOut ? styles.slotFull : undefined}>
                  <button
                    type="button"
                    className={styles.slotTrigger}
                    aria-expanded={open === sl.id}
                    onClick={() => {
                      if (lockedOut) {
                        setFullNote(sl.id);
                        window.setTimeout(
                          () => setFullNote((v) => (v === sl.id ? null : v)),
                          5000
                        );
                        return;
                      }
                      setOpen((v) => (v === sl.id ? null : sl.id));
                    }}
                  >
                    <span className={styles.slotTop}>
                      <span>
                        <strong>{sl.label}</strong>
                        <span className={styles.slotWhen}>
                          {sl.starts_at
                            ? `${formatTimeOfDay(sl.starts_at)} – ${sl.ends_at ? formatTimeOfDay(sl.ends_at) : ''}`
                            : 'Untimed'}
                          {!sl.attendance_required && ' · no attendance needed'}
                        </span>
                      </span>
                      <span className={styles.slotMeta}>
                        <span className={styles.elig}>
                          {sl.eligibility === 'both'
                            ? 'Everyone'
                            : sl.eligibility === 'scouts'
                              ? 'Scouts'
                              : 'Adults'}
                        </span>
                        <span className={styles.count}>
                          {sl.needed == null
                            ? `${filledOf(sl)} signed up`
                            : full
                              ? `Full (${sl.needed}/${sl.needed})`
                              : `${filledOf(sl)} of ${sl.needed} — ${sl.needed - filledOf(sl)} more needed`}
                        </span>
                        <span className={styles.jobCue}>
                          {gateState === 'anon'
                            ? 'Sign in to claim'
                            : gateState === 'no-household'
                              ? 'Choose your family'
                              : 'Sign up'}
                        </span>
                      </span>
                    </span>
                    <span className={styles.bar}>
                      <span style={{ width: `${pct}%` }} />
                    </span>
                  </button>

                  {fullNote === sl.id && (
                    <p className={styles.fullNote} role="status">
                      <strong>This job is full.</strong> All {sl.needed} spots are taken — pick
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
                              onClick={() => toggle(sl.id, k)}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {open === sl.id && rowPanel(sl)}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );

  // Not signed in / no family yet: the board stands alone, and each row can
  // carry its own gate form. No outer <form> to nest inside.
  const signOutBar = (
    <form action={signOutAction} className={styles.boardStatus}>
      <input type="hidden" name="next" value={`/events/${eventId}`} />
      <span>
        {ready ? (
          <>
            Signing up the <strong>{household!.label}</strong> household
          </>
        ) : (
          <>&#10003; You&rsquo;re signed in &mdash; no family chosen yet</>
        )}
      </span>
      <span className={styles.boardStatusActions}>
        {ready && (
          <a href={`/events/${eventId}`} className={styles.linkBtn}>
            Change household
          </a>
        )}
        {isFamilySession ? (
          <button type="submit" className={styles.linkBtn}>
            Sign out
          </button>
        ) : (
          <span className={styles.linkBtnQuiet}>signed in as a leader</span>
        )}
      </span>
    </form>
  );

  if (!ready) {
    return (
      <div className={styles.jobBoard}>
        {gateState === 'no-household' && signOutBar}
        <p className={styles.boardLede}>
          {gateState === 'anon'
            ? 'Pick a job below to sign in and claim it — one shared troop password, no account needed.'
            : 'Pick a job below, then choose your family.'}
        </p>
        {jobList}
      </div>
    );
  }

  return (
    <form action={submitAction} className={styles.signupForm}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="signupId" value={signupId} />
      <input type="hidden" name="householdKey" value={household!.key} />
      <input type="hidden" name="entries" value={JSON.stringify(entries)} />
      <input type="hidden" name="slotClaims" value={JSON.stringify(claimsForSubmit)} />

      {signOutBar}
      <p className={styles.boardLede}>
        {slotsIntro ??
          'Pick a job and choose who’s doing it — one person or several. Claiming a job is your signup; there’s no separate RSVP.'}
      </p>

      {jobList}

      {allowGuests && (
        <div className={styles.guestBlock}>
          <p className={styles.dayHead}>Guests coming along</p>
          <p className={styles.gateLede}>
            {guestPrompt ??
              'Friends and family joining — how many, so we can plan? We don’t need their names.'}
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
        {entries.length === 0 ? (
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
                  <em>
                    ({e.participation === 'contributor' ? 'Donating — not attending' : 'Helping'})
                  </em>
                  <span className={styles.recapJobs}>{mine.join(' · ')}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={styles.formActions}>
        <button type="submit" className={styles.gateBtn} disabled={entries.length === 0}>
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
