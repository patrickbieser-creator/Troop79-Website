'use client';

import { GuestRowsEditor, GuestCountField, type GuestRowValue } from './guest-rows';
import { SavingOverlay, intentOf, type SaveIntent } from './save-feedback';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SignupSlot, GuestMode, HouseholdGuest } from '@/lib/event-signup';
import { guestHostKey } from '@/lib/guest-payload';
import { PARTICIPANT_CLASS_LABEL } from '@/lib/participant-class';
import type { Household } from '@/lib/households';
import { formatTimeOfDay } from '@/lib/calendar-shared';
import styles from './event-detail.module.css';
import { Notice } from '@/app/_components/notice';

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
  /** people.id — the identity (signup_entries_person_uniq). */
  personId: number | null;
  /** leaders.code, or null when this adult is not on the adult roster. */
  leaderCode?: string | null;
}

export interface ExistingClaim {
  slotId: number;
  personKey: string;
  comment?: string | null;
}

export type GateState = 'anon' | 'no-household' | 'ready';

export default function SlotFirstForm({
  eventId,
  signupId,
  household,
  households,
  slots,
  guestMode,
  guestPrompt,
  existingGuests = [],
  existingGuestCount = { count: 0, note: '' },
  householdGuests = [],
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
  /** none · count · named (Plans/Guests-As-People.md). */
  guestMode: GuestMode;
  guestPrompt: string | null;
  /** The party's SAVED guest rows — seeded into the editor so a saved guest is
   *  visible, editable and removable (Patrick, 2026-08-23: "I cannot get Fred
   *  to show up anywhere"). */
  existingGuests?: GuestRowValue[];
  /** Count mode: the "+N guests" the host entry already carries. */
  existingGuestCount?: { count: number; note: string };
  /** The household's guests on record — one-click picks in named mode. */
  householdGuests?: HouseholdGuest[];
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
              scoutId: s.id,
              personId: s.personId
            })),
            ...household.adults.map((a, i) => ({
              key: `a${i}`,
              kind: 'adult' as const,
              name: a.name,
              /* A leader-roster adult has no relationship to a scout — calling
                 them "Parent" would be wrong, sometimes conspicuously so. */
              sub: a.relationship || (a.leaderCode ? 'Adult' : 'Parent'),
              personId: a.personId,
              leaderCode: a.leaderCode
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
  /** slotId -> this household's note about that job. Seeded from whatever was
   *  saved so an edit shows the current text instead of a blank box. */
  const [slotComments, setSlotComments] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    for (const c of existingClaims) if (c.comment) init[c.slotId] = c.comment;
    return init;
  });
  const [open, setOpen] = useState<number | null>(null);
  const [fullNote, setFullNote] = useState<number | null>(null);
  // Named guest rows (Plans/Participant-Classification.md) — seeded from what
  // is saved, same as the person-first form.
  const [guestRows, setGuestRows] = useState<GuestRowValue[]>(() => existingGuests.map((g) => ({ ...g })));
  const [guestCount, setGuestCount] = useState<{ count: number; note: string }>(existingGuestCount);
  const [saving, setSaving] = useState<SaveIntent | null>(null);
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
    // A person who HAD a job and now has none is sent as status 'no' — not
    // simply left out (Patrick, 2026-08-23: "the name Patrick reappeared
    // after I clicked Save Changes"). Absent meant untouched: their entry
    // stayed 'yes' and their claim stayed. 'no' lets the RPC flip the entry;
    // the action then drops the claims the form no longer carries.
    const hadEntry = new Set(existingClaims.map((c) => c.personKey));
    return people
      .filter((p) => (claimedBy.get(p.key) ?? []).length > 0 || hadEntry.has(p.key))
      .map((p) => {
        const mine = claimedBy.get(p.key) ?? [];
        const donationOnly = mine.length > 0 && mine.every((s) => !s.attendance_required);
        return {
          key: p.key,
          person_kind: p.kind,
          // scout_parent_id/leader_code no longer sent — person_id is always
          // resolvable here and is the sole identity the RPC's party-
          // membership check validates against.
          scout_id: p.scoutId ?? null,
          person_id: p.personId,
          status: mine.length > 0 ? 'yes' : 'no',
          participation: donationOnly ? 'contributor' : 'full',
          // Named guests travel in the `guests` field; the count (count mode)
          // is attached to the host entry below.
          guest_count: 0,
          guest_note: null
        };
      });
  }, [claims, people, slots, ready, existingClaims]);
  // Count mode: "+N guests" rides on the first helping member.
  const entriesWithGuests = useMemo(() => {
    if (guestMode !== 'count' || guestCount.count === 0) return entries;
    const hostKey = guestHostKey(entries);
    if (!hostKey) return entries;
    return entries.map((e) => (e.key === hostKey ? { ...e, guest_count: guestCount.count, guest_note: guestCount.note.trim() || null } : e));
  }, [entries, guestMode, guestCount]);
  const activeEntries = entries.filter((e) => e.status === 'yes');

  // Dirty = the board differs from what is saved: claims, notes, or a guest
  // row typed. Save is disabled otherwise (Patrick, 2026-08-23: "the Save
  // Changes button appears and is active, yet does nothing").
  const claimsKey = (pairs: { slotId: number; personKey: string }[]) => pairs.map((c) => `${c.slotId}:${c.personKey}`).sort().join('|');
  const savedClaimsKey = useMemo(() => claimsKey(existingClaims), [existingClaims]);
  const draftClaimsKey = claimsKey(Object.entries(claims).flatMap(([slotId, keys]) => keys.map((personKey) => ({ slotId: Number(slotId), personKey }))));
  const savedComments = useMemo(() => {
    const m: Record<number, string> = {};
    for (const c of existingClaims) if (c.comment) m[c.slotId] = c.comment.trim();
    return m;
  }, [existingClaims]);
  const commentsDirty = Object.entries(claims).some(([slotId, keys]) => keys.length > 0 && (slotComments[Number(slotId)] ?? '').trim() !== (savedComments[Number(slotId)] ?? ''));
  // Guests: compare the named rows (blank names ignored; a re-picked person
  // by id) and the count with what is saved.
  const guestsKey = (rows: GuestRowValue[]) =>
    rows
      .map((g) => (g.personId != null ? `p:${g.personId}|${g.cls}|${g.attending ? 'y' : 'n'}` : `${g.name.trim().toLowerCase()}|${g.cls}|${g.phone.trim()}|${g.attending ? 'y' : 'n'}`))
      .filter((k) => !k.startsWith('|'))
      .sort()
      .join(',');
  const savedGuestsKey = useMemo(() => guestsKey(existingGuests), [existingGuests]);
  const namedGuests = guestMode === 'named' ? guestRows.filter((g) => g.name.trim() && g.attending) : [];
  const guestsDirty =
    guestMode === 'named'
      ? guestsKey(guestRows) !== savedGuestsKey
      : guestMode === 'count'
        ? guestCount.count !== existingGuestCount.count || guestCount.note.trim() !== existingGuestCount.note.trim()
        : false;
  const dirty = draftClaimsKey !== savedClaimsKey || commentsDirty || guestsDirty;
  // A guest row is stored under a household member who is signed up (the
  // host); with nobody helping there is nobody to attach them to, and the
  // action would drop them silently — block Save and say so instead.
  const guestsNeedAHelper = (namedGuests.length > 0 || (guestMode === 'count' && guestCount.count > 0)) && activeEntries.length === 0;

  const claimsForSubmit = useMemo(() => {
    const byPerson: Record<string, number[]> = {};
    for (const [slotId, keys] of Object.entries(claims)) {
      for (const k of keys) byPerson[k] = [...(byPerson[k] ?? []), Number(slotId)];
    }
    return byPerson;
  }, [claims]);

  /* Searches SCOUTS AND ADULTS — the same rule household-picker.tsx has always
     used, which this board never picked up. Matching only scouts meant an
     adult with no active scout (a committee member, a merit badge counselor,
     the parent of a scout who aged out) could not reach the form at all: they
     are a household of one with `scouts: []`, so they contributed no rows to
     the match list and the board told them "No scout by that name". They are
     exactly who volunteers for a fundraiser. */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return households
      .flatMap((h) => [
        ...h.scouts.map((s) => ({
          household: h,
          rowKey: `s:${s.id}`,
          name: s.displayName,
          isScout: true
        })),
        ...h.adults.map((a) => ({
          household: h,
          rowKey: `a:${a.key}`,
          name: a.name,
          isScout: false
        }))
      ])
      .filter((p) => `${p.name} ${p.household.label}`.toLowerCase().includes(q))
      .slice(0, 8);
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
                <Notice tone="error" className={styles.noticeGapTop}>That password didn’t match. Try again.</Notice>
              )}
              {gateError === 'missing' && (
                <Notice tone="error" className={styles.noticeGapTop}>Please enter the troop password.</Notice>
              )}
            </form>
          )}
        </div>
      );
    }

    if (gateState === 'no-household') {
      return (
        <div className={styles.memberPick}>
          <p className={styles.pickPrompt}>Who’s signing up for “{sl.label}”?</p>
          <input
            type="search"
            className={styles.gateInput}
            placeholder="Your name, or your scout’s name…"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Your name, or your scout’s name"
          />
          {query.trim().length >= 2 && (
            <ul className={styles.pickerResults}>
              {matches.length === 0 && (
                <li className={styles.pickerNone}>
                  Nobody by that name — check the spelling, or ask a leader to add you.
                </li>
              )}
              {matches.map((p) => (
                <li key={p.rowKey}>
                  <button
                    type="button"
                    className={styles.pickerBtn}
                    onClick={() =>
                      router.push(
                        `/events/${eventId}/signup?household=${encodeURIComponent(p.household.key)}`
                      )
                    }
                  >
                    <span className={styles.pickerName}>{p.name}</span>
                    <span className={styles.pickerMeta}>
                      {/* A household of one has nothing useful to say about
                          itself — "the Jane Smith household · 0 scouts" reads
                          as a bug to the person it describes. */}
                      {p.household.scouts.length === 0
                        ? p.isScout
                          ? 'Scout'
                          : 'Adult — no scout in the troop'
                        : p.household.scouts.length > 1
                          ? `${p.household.label} household · ${p.household.scouts.length} scouts`
                          : `${p.household.label} household`}
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
                    {/* Below the whole header row, not inside the title block:
                        nested in the title span it widened that flex child
                        enough to wrap the count/CTA onto its own line, so a job
                        WITH a description had a different shape from one
                        without and its text floated mid-card, reading as though
                        it belonged to the next job down. */}
                    {sl.description && (
                      <span className={styles.slotDesc}>{sl.description}</span>
                    )}
                    <span className={styles.bar}>
                      {/* dynamic: fill percentage */}
                      <span style={{ width: `${pct}%` }} />
                    </span>
                  </button>

                  {fullNote === sl.id && (
                    <p className={styles.fullNote} role="status">
                      <strong>This job is full.</strong> All {sl.needed} spots are taken — pick
                      another job, or ask a leader if you think there’s room.
                    </p>
                  )}

                  {/* Only once somebody actually holds the job — an empty note
                      box on all 40 jobs of a rummage sale would be noise. */}
                  {ready && mine.length > 0 && (
                    <div className={styles.noteRow}>
                      <label className={styles.noteLabel} htmlFor={`note-${sl.id}`}>
                        Anything the organizers should know? (optional)
                      </label>
                      <input
                        id={`note-${sl.id}`}
                        type="text"
                        maxLength={300}
                        className={styles.noteInput}
                        placeholder="e.g. I have a 6ft table · can only stay until noon"
                        value={slotComments[sl.id] ?? ''}
                        onChange={(e) =>
                          setSlotComments((v) => ({ ...v, [sl.id]: e.target.value }))
                        }
                      />
                    </div>
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
  // `asForm` matters: when the board stands alone (anon / no household) this
  // is its own <form>. Inside the submit form it must NOT be — nested forms
  // are invalid HTML and React reports a hydration error.
  const statusBar = (asForm: boolean) => {
    const inner = (
      <>
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
        {/* Explicit empty ?household= — a verified visitor's prefill only
            fires when the param is ABSENT (same trick as the person-first
            page's "Not you? Change"). */}
        {ready && (
          <a href={`/events/${eventId}/signup?household=`} className={styles.linkBtn}>
            Change household
          </a>
        )}
          {isFamilySession ? (
            <button
              type="submit"
              className={styles.linkBtn}
              formAction={asForm ? undefined : signOutAction}
            >
              Sign out
            </button>
          ) : (
            <span className={styles.linkBtnQuiet}>signed in as a leader</span>
          )}
        </span>
      </>
    );
    return asForm ? (
      <form action={signOutAction} className={styles.boardStatus}>
        <input type="hidden" name="next" value={`/events/${eventId}`} />
        {inner}
      </form>
    ) : (
      <div className={styles.boardStatus}>{inner}</div>
    );
  };

  if (!ready) {
    return (
      <div className={styles.jobBoard}>
        {gateState === 'no-household' && statusBar(true)}
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
    <form action={submitAction} className={styles.signupForm} onSubmit={(e) => setSaving(intentOf(e))}>
      <SavingOverlay intent={saving} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="signupId" value={signupId} />
      <input type="hidden" name="householdKey" value={household!.key} />
      <input type="hidden" name="entries" value={JSON.stringify(entriesWithGuests)} />
      <input type="hidden" name="slotClaims" value={JSON.stringify(claimsForSubmit)} />
      <input type="hidden" name="slotComments" value={JSON.stringify(slotComments)} />
      <input type="hidden" name="next" value={`/events/${eventId}`} />

      {statusBar(false)}
      <p className={styles.boardLede}>
        Pick a job and choose who’s doing it — one person or several. Claiming a job is your
        signup; there’s no separate RSVP.
      </p>

      {jobList}

      {guestMode === 'named' && (
        <GuestRowsEditor guests={guestRows} onChange={setGuestRows} prompt={guestPrompt} previousGuests={householdGuests} />
      )}
      {guestMode === 'count' && (
        <GuestCountField count={guestCount.count} note={guestCount.note} onChange={setGuestCount} prompt={guestPrompt} />
      )}

      <div className={styles.recap}>
        <p className={styles.dayHead}>Your household’s jobs{namedGuests.length > 0 || (guestMode === 'count' && guestCount.count > 0) ? ' & guests' : ''}</p>
        {activeEntries.length === 0 ? (
          <p className={styles.recapEmpty}>
            No jobs claimed yet — pick one above and say who’s doing it.
          </p>
        ) : (
          <ul className={styles.recapList}>
            {activeEntries.map((e) => {
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
        {guestMode === 'count' && guestCount.count > 0 && (
          <ul className={styles.recapList}>
            <li>
              <strong>+{guestCount.count} {guestCount.count === 1 ? 'guest' : 'guests'}</strong>
              {guestCount.note.trim() && <em> ({guestCount.note.trim()})</em>}
              <span className={styles.recapJobs}>
                {activeEntries.length === 0
                  ? 'Guests are counted with whoever from your household is helping — pick a job for at least one person above.'
                  : 'Counted with your household — saved with Save changes.'}
              </span>
            </li>
          </ul>
        )}
        {namedGuests.length > 0 && (
          <ul className={styles.recapList}>
            {namedGuests.map((g, i) => (
              <li key={`g${i}`}>
                <strong>{g.name.trim()}</strong> <em>(Guest — {PARTICIPANT_CLASS_LABEL[g.cls]})</em>
                <span className={styles.recapJobs}>
                  {guestsNeedAHelper
                    ? 'Guests are saved with whoever from your household is helping — pick a job for at least one person above.'
                    : 'Comes along with your household — saved with Save changes.'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.formActions}>
        {/* First submit needs at least one job; after that, Save is live only
            when something changed (a removed person is a change — it saves
            them as declined and frees the job). */}
        <button
          type="submit"
          className={styles.gateBtn}
          disabled={guestsNeedAHelper || (hasExisting ? !dirty : activeEntries.length === 0)}
          title={guestsNeedAHelper ? 'Pick a job for at least one person first — guests are saved with them' : hasExisting && !dirty ? 'No changes to save yet' : undefined}
        >
          {hasExisting ? (dirty ? 'Save changes' : 'Saved') : 'Submit family signup'}
        </button>
      </div>

      {hasExisting && (
        <p className={styles.cancelRow}>
          <button type="submit" formAction={cancelAction} className={styles.linkBtn} data-intent="cancel">
            Cancel our whole signup
          </button>
        </p>
      )}
    </form>
  );
}
