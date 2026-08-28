'use client';

import { GuestRowsEditor, GuestCountField, GuestsLocked, type GuestRowValue } from './guest-rows';
import { SavingOverlay, intentOf, type SaveIntent } from './save-feedback';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SignupSlot, GuestMode, HouseholdGuest } from '@/lib/event-signup';
import { guestHostKey } from '@/lib/guest-payload';
import { PARTICIPANT_CLASS_LABEL } from '@/lib/participant-class';
import type { Household } from '@/lib/households';
import { formatTimeOfDay } from '@/lib/calendar-shared';
import styles from './event-detail.module.css';
import { SignupStatusBar } from './signup-status-bar';
import { Notice } from '@/app/_components/notice';

import { fmtDay } from '@/lib/format-date';

/** Stable "nobody's claimed this yet" fallback — `claims[slotId] ?? []` would
 *  otherwise mint a new empty array every render, which would make every
 *  unclaimed job's row look "changed" to React.memo and defeat the
 *  memoisation below (Performance-Review-2026-08-27 #15). */
const EMPTY_CLAIMS: string[] = [];
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

interface Match {
  household: Household;
  rowKey: string;
  name: string;
  isScout: boolean;
}

/** Pure — who may take a job. Lives outside the component so SlotRow's memo
 *  doesn't need a fresh closure every render (Performance-Review-2026-08-27 #15). */
const isEligible = (p: Person, s: SignupSlot) =>
  s.eligibility === 'both' || (s.eligibility === 'scouts' ? p.kind === 'scout' : p.kind === 'adult');

/** Everything a slot row's expanded gate panel needs that ISN'T specific to
 *  that one slot. Passed down as a single memoised object so a keystroke in
 *  one row's note (or a claim toggle elsewhere) doesn't change this
 *  reference and doesn't invalidate every other row's React.memo. */
interface SlotRowShared {
  gateState: GateState;
  canSwitchHousehold: boolean;
  gateConfigured: boolean;
  gateError?: string;
  gateAction: (fd: FormData) => void;
  eventId: number;
  household: Household | null;
  people: Person[];
  query: string;
  matches: Match[];
  onQueryChange: (value: string) => void;
  onGoToHousehold: (householdKey: string) => void;
}

/** One job's row — trigger, fill bar, claimer chips, optional note, and (when
 *  open) the gate/member-picker panel. Wrapped in React.memo so typing in
 *  this row's note does not re-render the other 29 jobs on a rummage sale
 *  board (Performance-Review-2026-08-27 #15). `renderProbe` is test-only
 *  instrumentation — SlotFirstForm never passes it in production, and it
 *  never reaches markup — see tests/slot-first-form-row-memo.test.tsx. */
const SlotRow = memo(function SlotRow({
  sl,
  mine,
  filled,
  full,
  lockedOut,
  pct,
  gateCue,
  open,
  fullNoteShown,
  ready,
  comment,
  onNoteChange,
  onSlotClick,
  onToggleClaim,
  shared,
  renderProbe
}: {
  sl: SignupSlot;
  mine: string[];
  filled: number;
  full: boolean;
  lockedOut: boolean;
  pct: number;
  /** "Sign in to claim" / "Choose the family" / "Ask a leader" / "Sign up" —
   *  depends only on gateState/canSwitchHousehold, same for every row, but
   *  computed once at the parent alongside the other gate-state props. */
  gateCue: string;
  open: boolean;
  fullNoteShown: boolean;
  ready: boolean;
  comment: string;
  onNoteChange: (slotId: number, value: string) => void;
  onSlotClick: (slotId: number, lockedOut: boolean) => void;
  onToggleClaim: (slotId: number, personKey: string) => void;
  shared: SlotRowShared;
  renderProbe?: (key: string) => void;
}) {
  renderProbe?.(`slot:${sl.id}`);

  /** What opens under this job row, depending on how far in the visitor is. */
  const renderPanel = () => {
    const {
      gateState,
      canSwitchHousehold,
      gateConfigured,
      gateError,
      gateAction,
      eventId,
      household,
      people,
      query,
      matches,
      onQueryChange,
      onGoToHousehold
    } = shared;

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

    if (gateState === 'no-household' && !canSwitchHousehold) {
      return (
        <div className={styles.memberPick}>
          <p className={styles.gateLede}>
            There’s no household on record for you yet — ask a leader to add you to one, then come back
            to claim “{sl.label}”.
          </p>
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
            onChange={(e) => onQueryChange(e.target.value)}
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
                    onClick={() => onGoToHousehold(p.household.key)}
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

    return (
      <div className={styles.memberPick}>
        <p className={styles.pickPrompt}>Who from the {household!.label} family is doing this?</p>
        <div className={styles.pickChips}>
          {people.map((p) => {
            const on = mine.includes(p.key);
            const ok = isEligible(p, sl);
            const blocked = !ok || (full && !on);
            return (
              <button
                key={p.key}
                type="button"
                className={`${styles.pickChip} ${on ? styles.pickOn : ''} ${blocked ? styles.pickBlocked : ''}`}
                disabled={blocked}
                aria-pressed={on}
                onClick={() => onToggleClaim(sl.id, p.key)}
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

  return (
    <li className={lockedOut ? styles.slotFull : undefined}>
      <button
        type="button"
        className={styles.slotTrigger}
        aria-expanded={open}
        onClick={() => onSlotClick(sl.id, lockedOut)}
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
                ? `${filled} signed up`
                : full
                  ? `Full (${sl.needed}/${sl.needed})`
                  : `${filled} of ${sl.needed} — ${sl.needed - filled} more needed`}
            </span>
            <span className={styles.jobCue}>{gateCue}</span>
          </span>
        </span>
        {/* Below the whole header row, not inside the title block:
            nested in the title span it widened that flex child
            enough to wrap the count/CTA onto its own line, so a job
            WITH a description had a different shape from one
            without and its text floated mid-card, reading as though
            it belonged to the next job down. */}
        {sl.description && <span className={styles.slotDesc}>{sl.description}</span>}
        <span className={styles.bar}>
          {/* dynamic: fill percentage */}
          <span style={{ width: `${pct}%` }} />
        </span>
      </button>

      {fullNoteShown && (
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
            value={comment}
            onChange={(e) => onNoteChange(sl.id, e.target.value)}
          />
        </div>
      )}

      {mine.length > 0 && (
        <div className={styles.claimerChips}>
          {mine.map((k) => {
            const p = shared.people.find((x) => x.key === k);
            if (!p) return null;
            return (
              <span key={k} className={styles.claimerChip}>
                {p.name.split(' ')[0]}
                <button
                  type="button"
                  className={styles.claimerX}
                  aria-label={`Remove ${p.name}`}
                  onClick={() => onToggleClaim(sl.id, k)}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {open && renderPanel()}
    </li>
  );
});

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
  signedInAs,
  canSwitchHousehold,
  gateError,
  gateConfigured,
  renderProbe
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
  /** Who is signed in — shown on the status bar. */
  signedInAs: string | null;
  /** Household scope (2026-08-27): only a superuser sees the find-a-family
   *  search and "Change household"; a family is pinned to its own. */
  canSwitchHousehold: boolean;
  gateError?: string;
  gateConfigured: boolean;
  /** Test-only render-count probe (tests/slot-first-form-row-memo.test.tsx)
   *  — never passed in production, never touches markup. */
  renderProbe?: (slotKey: string) => void;
}) {
  const router = useRouter();
  // A ref, not a dependency: useRouter()'s return isn't guaranteed
  // referentially stable across renders, and including it directly in
  // rowSharedProps' deps below would recompute that object (and invalidate
  // every SlotRow's memo) on every render regardless of what actually
  // changed. Reading through the ref keeps navigation working off whatever
  // router is current without router itself needing to be a stable value.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });
  const goToHousehold = useCallback(
    (householdKey: string) => {
      routerRef.current.push(`/events/${eventId}/signup?household=${encodeURIComponent(householdKey)}`);
    },
    [eventId]
  );
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

  const claimersOf = (slotId: number) => claims[slotId] ?? EMPTY_CLAIMS;
  const filledOf = (s: SignupSlot) => {
    const mineExisting = existingClaims.filter((c) => c.slotId === s.id).length;
    return s.filled - mineExisting + claimersOf(s.id).length;
  };
  const isFull = (s: SignupSlot) => s.needed != null && filledOf(s) >= s.needed;

  // Stable across renders (functional setState, no closure over anything that
  // changes) so a SlotRow's props don't look "changed" just because some
  // other row's note or claim moved — the point of memoising SlotRow at all.
  const toggle = useCallback((slotId: number, personKey: string) => {
    setClaims((prev) => {
      const cur = prev[slotId] ?? EMPTY_CLAIMS;
      return {
        ...prev,
        [slotId]: cur.includes(personKey)
          ? cur.filter((k) => k !== personKey)
          : [...cur, personKey]
      };
    });
  }, []);
  const handleNoteChange = useCallback((slotId: number, value: string) => {
    setSlotComments((v) => ({ ...v, [slotId]: value }));
  }, []);
  const handleSlotClick = useCallback((slotId: number, lockedOut: boolean) => {
    if (lockedOut) {
      setFullNote(slotId);
      window.setTimeout(() => setFullNote((v) => (v === slotId ? null : v)), 5000);
      return;
    }
    setOpen((v) => (v === slotId ? null : slotId));
  }, []);
  const handleQueryChange = useCallback((value: string) => setQuery(value), []);

  const groups = useMemo(() => {
    const out: { day: string; items: SignupSlot[] }[] = [];
    for (const s of slots) {
      const label = s.slot_date
        ? fmtDay(s.slot_date)
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

  // Everything a row's expanded panel needs that is the same for every slot
  // — memoised so a keystroke in one row's note, or a claim toggled anywhere,
  // doesn't hand every OTHER row a new object reference and defeat SlotRow's
  // React.memo (Performance-Review-2026-08-27 #15).
  const rowSharedProps: SlotRowShared = useMemo(
    () => ({
      gateState,
      canSwitchHousehold,
      gateConfigured,
      gateError,
      gateAction,
      eventId,
      household,
      people,
      query,
      matches,
      onQueryChange: handleQueryChange,
      onGoToHousehold: goToHousehold
    }),
    [gateState, canSwitchHousehold, gateConfigured, gateError, gateAction, eventId, household, people, query, matches, handleQueryChange, goToHousehold]
  );
  const gateCue =
    gateState === 'anon'
      ? 'Sign in to claim'
      : gateState === 'no-household'
        ? canSwitchHousehold
          ? 'Choose the family'
          : 'Ask a leader'
        : 'Sign up';

  const jobList = (
    <>
      {groups.map((g) => (
        <div key={g.day} className={styles.dayGroup}>
          <p className={styles.dayHead}>{g.day}</p>
          <ul className={styles.slotList}>
            {g.items.map((sl) => {
              const mine = claimersOf(sl.id);
              const filled = filledOf(sl);
              const full = isFull(sl);
              const lockedOut = full && mine.length === 0 && ready;
              const pct = sl.needed ? Math.min(100, Math.round((filled / sl.needed) * 100)) : 0;
              return (
                <SlotRow
                  key={sl.id}
                  sl={sl}
                  mine={mine}
                  filled={filled}
                  full={full}
                  lockedOut={lockedOut}
                  pct={pct}
                  gateCue={gateCue}
                  open={open === sl.id}
                  fullNoteShown={fullNote === sl.id}
                  ready={ready}
                  comment={slotComments[sl.id] ?? ''}
                  onNoteChange={handleNoteChange}
                  onSlotClick={handleSlotClick}
                  onToggleClaim={toggle}
                  shared={rowSharedProps}
                  renderProbe={renderProbe}
                />
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
  // One bar for both forms (Verified Signup, 2026-08-26) — says WHO is signed
  // in, not just which household. Standalone (not-ready board) it is its own
  // <form>; inside the submit form it must not be (nested forms are invalid
  // HTML and React reports a hydration error), so sign-out becomes a
  // formAction button there.
  const statusBar = (asForm: boolean) => (
    <SignupStatusBar
      nested={!asForm}
      signedInAs={signedInAs}
      household={ready ? { label: household!.label, standaloneAdult: household!.scouts.length === 0 } : null}
      changeHref={canSwitchHousehold ? `/events/${eventId}/signup?household=` : undefined}
      signOut={{ action: signOutAction, next: `/events/${eventId}/signup?signedout=1` }}
    />
  );

  if (!ready) {
    return (
      <div className={styles.jobBoard}>
        {gateState === 'no-household' && statusBar(true)}
        <p className={styles.boardLede}>
          {gateState === 'anon'
            ? 'Pick a job below to sign in and claim it.'
            : canSwitchHousehold
              ? 'Pick a job below, then choose the family.'
              : 'Pick a job below.'}
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

      {guestMode !== 'none' && activeEntries.length === 0 && (
        <GuestsLocked
          mode={guestMode}
          why="Pick a job for at least one person in your household first — guests come along with them."
        />
      )}
      {guestMode === 'named' && activeEntries.length > 0 && (
        <GuestRowsEditor guests={guestRows} onChange={setGuestRows} prompt={guestPrompt} previousGuests={householdGuests} />
      )}
      {guestMode === 'count' && activeEntries.length > 0 && (
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
