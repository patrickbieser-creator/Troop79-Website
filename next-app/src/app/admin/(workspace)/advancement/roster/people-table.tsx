'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addRole,
  endRole,
  deleteRole,
  setHousehold,
  addRelationship,
  removeRelationship,
  searchPeople,
  getPersonDetail,
  updatePersonDemographics,
  setPersonActive,
  mergePersonInto,
  deletePerson,
  createHouseholdForPerson,
  renameHousehold,
  sendSignInLink,
  getPersonEmails,
  addPersonEmailAction,
  setPersonPrimaryEmailAction,
  removePersonEmailAction,
  type GrantableRole,
  type RelationshipInput,
  type PersonDetail
} from './person-actions';
import type { PersonEmailRow, PersonEmailLabel } from '@/lib/person-emails';
import { FormSection } from '../../../_components/form-panel';
import { PendingUpdatePanel } from './pending-update-panel';
import { AdultForm } from './adult-form';
import { DatePickerField } from '../../_components/date-picker-field';
import { AddButton } from '../../_components/add-button';
import { Badge } from '../../_components/badge';
import { SortHeader, useSortable } from '../../_components/use-sortable';
import { Dialog } from '../../_components/dialog';
import { Notice } from '../../_components/notice';
import { DiscardButton, SaveButton, SaveFeedback, useSavePhase } from '../../_components/save-state';
import { Button } from '../../../_components/button';
import { FormPanel } from '../../../_components/form-panel';
import { ageOn, yptStatus } from '@/lib/demographics';
import { fmtDate } from '@/lib/format-date';
import styles from './roster.module.css';
// Field CSS converged onto lookups' family (D-139 answered, 2026-08-21) —
// roster.module.css's hand-copied .editGrid/.editField block is deleted.
// The Demographics grid sits in a FormPanel (2026-08-26 sweep) — .fieldGrid
// carries no tint of its own; .editorSection (below) never had one either.
import fields from '../lookups/lookups.module.css';

export interface DirectoryPerson {
  person_id: number;
  display_name: string;
  primary_email: string | null;
  primary_phone: string | null;
  bsa_member_id: string | null;
  scout_id: string | null;
  inactive_reason: string | null;
  roles: string;
  tab: 'active_scout' | 'inactive_scout' | 'leader' | 'adult';
  in_picker: boolean;
  active: boolean;
  person_inactive_reason: string | null;
}

export interface PersonRoleRow {
  id: number;
  person_id: number;
  role: string;
  start_date: string | null;
  end_date: string | null;
}

export interface RelationshipRow {
  id: number;
  person_id: number;
  related_person_id: number;
  type: 'parent_of' | 'guardian_of' | 'sibling_of' | 'emergency_contact_for';
  is_guardian: boolean;
}

export interface HouseholdOption {
  id: number;
  label: string;
}

/** PersonEditor's Demographics form state — one object per LEADER_PERSON_FIELDS
 *  field, all strings (dates included; DatePickerField's own value shape). */
interface DemoForm {
  firstName: string;
  lastName: string;
  birthdate: string;
  email: string;
  phone: string;
  addr1: string;
  addr2: string;
  city: string;
  state: string;
  zip: string;
  bsaMemberId: string;
  yptCompleted: string;
  healthFormDate: string;
  thingsWeShouldKnow: string;
}

const ROLE_LABEL: Record<string, string> = {
  adult_leader: 'Adult leader',
  committee_member: 'Committee member',
  chartered_org_rep: 'Chartered org rep',
  merit_badge_counselor: 'Merit badge counselor',
  external_contact: 'External contact',
  youth_member: 'Youth member'
};

/** Only these three put someone on the Leaders tab. A merit badge counselor
 *  with no other role is an Adult — the "outside merit badge counselor" case. */
const GRANTABLE: GrantableRole[] = [
  'adult_leader',
  'committee_member',
  'chartered_org_rep',
  'merit_badge_counselor',
  'external_contact'
];

/** Copy for every way sendSignInLink() can fail to send — same three
 *  outcomes requestChallengeForPerson() distinguishes (unlike the
 *  enumeration-safe /signin path, a leader acting from the roster is allowed
 *  to be told the truth). */
const SEND_LINK_REASON: Record<'unreachable' | 'rate-limited' | 'failed', string> = {
  unreachable: 'Add an email address first.',
  'rate-limited': 'Already sent recently — try again in a few minutes.',
  failed: "Couldn't send the link — try again."
};

const RELATION_WORDS: Record<RelationshipRow['type'], string> = {
  parent_of: 'parent of',
  guardian_of: 'guardian of',
  sibling_of: 'sibling of',
  emergency_contact_for: 'emergency contact for'
};

type PeopleColKey = 'name' | 'email' | 'phone' | 'bsa';

/** Module scope on purpose — see the note on useSortable. */
function personValue(p: DirectoryPerson, key: PeopleColKey): unknown {
  switch (key) {
    case 'name':
      return p.display_name;
    case 'email':
      return p.primary_email;
    case 'phone':
      return p.primary_phone;
    case 'bsa':
      return p.bsa_member_id;
  }
}

export function PeopleTable({
  people,
  roles,
  relationships,
  households,
  householdByPerson,
  householdMembers,
  nameById,
  openPersonId
}: {
  people: DirectoryPerson[];
  roles: PersonRoleRow[];
  relationships: RelationshipRow[];
  households: HouseholdOption[];
  householdByPerson: Record<number, number>;
  householdMembers: Record<number, string[]>;
  nameById: Record<number, string>;
  /** ?open=<people.id> — deep link from the dashboard's pending-update list,
   *  matching ScoutsTable's openScoutId. */
  openPersonId?: string;
}) {
  const router = useRouter();
  // The whole row, not just an id. Adding a role moves someone from Adults to
  // Leaders, so they leave `people` on the very refresh that follows the save —
  // and looking them up by id in a list they had just left returned undefined,
  // which a non-null assertion happily passed into the editor. That was the
  // page-load error: the save succeeded, then the dialog crashed rendering a
  // person who was no longer on the tab.
  const [openPerson, setOpenPerson] = useState<DirectoryPerson | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!openPersonId) return;
    const match = people.find((p) => String(p.person_id) === openPersonId);
    // Prefilling from the URL's ?open= param (external to render) on mount —
    // same pattern as scouts-table.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (match) setOpenPerson(match);
  }, [openPersonId, people]);

  // null initial key: the server's display_name order IS the default; sorting
  // starts only when a header is clicked.
  // The name search moved above the tabs (RosterSearch, 2026-08-27).
  const { sorted, sortKey, sortDir, toggle } = useSortable<DirectoryPerson, PeopleColKey>(
    people,
    personValue,
    null
  );

  return (
    <div>
      <div className={styles.tableToolbar}>
        <span className={styles.toolbarSpacer} />
        {/* The front door adults never had — same toolbar position as the
            Scouts tab's "+ Add Scout". */}
        <AddButton onClick={() => setAdding(true)}>+ Add Adult</AddButton>
      </div>

      {adding && (
        <AdultForm
          households={households}
          onClose={() => setAdding(false)}
          onCreated={() => router.refresh()}
        />
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <SortHeader label="Name" colKey="name" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
            <SortHeader label="Email" colKey="email" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
            <SortHeader label="Phone" colKey="phone" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
            <th>Roles</th>
            <th>Household</th>
            <SortHeader label="BSA ID" colKey="bsa" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
            {/* Status is the LAST column on every roster grid (Patrick, 2026-08-27). */}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const hh = householdByPerson[p.person_id];
            return (
              <tr key={p.person_id}>
                <td>
                  {/* Same bare name trigger and status Badge as the Scouts tab
                      (Jenna's roster alignment, 2026-08-27). */}
                  <button
                    type="button"
                    className={styles.nameBtn}
                    onClick={() => setOpenPerson(p)}
                    title="Edit this person"
                  >
                    {p.display_name}
                  </button>
                </td>
                <td>{p.primary_email || <span className={styles.muted}>—</span>}</td>
                <td>{p.primary_phone || <span className={styles.muted}>—</span>}</td>
                <td>
                  {p.roles
                    ? p.roles
                        .split(', ')
                        .map((r) => ROLE_LABEL[r] ?? r)
                        .join(', ')
                    : <span className={styles.muted}>none</span>}
                </td>
                <td>
                  {/* "Vest (4)" — the member count in parentheses keeps the row to
                      one line (Patrick, 2026-08-27). */}
                  {hh ? (
                    `${households.find((h) => h.id === hh)?.label ?? ''} (${(householdMembers[hh] ?? []).length})`
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td className={styles.mono}>{p.bsa_member_id || <span className={styles.muted}>—</span>}</td>
                <td>
                  {p.active ? (
                    <Badge variant="success" title="Offered in the family signup picker">
                      Active
                    </Badge>
                  ) : (
                    <Badge
                      variant="danger"
                      title={
                        p.person_inactive_reason
                          ? `Not offered at signup — ${p.person_inactive_reason}`
                          : 'Not offered at signup; still on record'
                      }
                    >
                      Inactive
                    </Badge>
                  )}
                </td>
                {/* The trailing duplicate Edit button is gone (Section 2
                    stretched-link sweep, 2026-08-21) — the name is the single
                    way into the editor, matching ScoutsTable. */}
              </tr>
            );
          })}
        </tbody>
      </table>

      {openPerson !== null && (
        <PersonEditor
          person={openPerson}
          households={households}
          seed={{
            active: openPerson.active,
            inactiveReason: openPerson.person_inactive_reason,
            tab: openPerson.tab,
            householdId: householdByPerson[openPerson.person_id] ?? null,
            // The seed is what the table row already knows; demographics are
            // not on it. The editor's own getPersonDetail() fills them in on
            // open, which is when the Pending Update diff needs them.
            fields: {},
            roles: roles
              .filter((r) => r.person_id === openPerson.person_id)
              .map((r) => ({ id: r.id, role: r.role, start_date: r.start_date, end_date: r.end_date })),
            relationships: relationships
              .filter(
                (r) =>
                  r.person_id === openPerson.person_id ||
                  r.related_person_id === openPerson.person_id
              )
              .map((r) => {
                const outgoing = r.person_id === openPerson.person_id;
                return {
                  id: r.id,
                  outgoing,
                  type: r.type,
                  isGuardian: r.is_guardian,
                  otherName: nameById[outgoing ? r.related_person_id : r.person_id] ?? 'someone'
                };
              })
          }}
          currentTab={people[0]?.tab ?? null}
          onClose={() => setOpenPerson(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function PersonEditor({
  person,
  households,
  seed,
  currentTab,
  onClose,
  onChanged
}: {
  person: DirectoryPerson;
  households: HouseholdOption[];
  seed: PersonDetail;
  /** Which tab is being viewed, so a person who has just moved off it can say
   *  so rather than silently vanishing from the list behind the dialog. */
  currentTab: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newRole, setNewRole] = useState<GrantableRole>('adult_leader');
  const [relType, setRelType] = useState<RelationshipInput>('parent_of');
  const [isGuardian, setIsGuardian] = useState(false);
  const [reason, setReason] = useState('');
  // True only while the admin has picked the Inactive radio but hasn't
  // confirmed yet — lets the reason box "pop up" without firing the mutation
  // before there's a chance to type a reason (same UX as the Scout editor's
  // Active/Inactive radios in scout-form.tsx).
  const [pendingInactive, setPendingInactive] = useState(false);
  const [newHouseholdLabel, setNewHouseholdLabel] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameLabel, setRenameLabel] = useState('');
  // Collapsed by default — read far more rarely than every other section here,
  // and the dialog is long enough without it open by default. A plain
  // useState toggle, not <details>/<summary>: a closed <details> silently hid
  // its content in a way CSS couldn't override and shipped broken to
  // production twice (D-070, 2026-07-19) — not a mechanism to reach for here.
  const [showDanger, setShowDanger] = useState(false);
  // "Send sign-in link" (Plans/Verified-Signup.md Phase A) — its own busy/
  // result state, separate from `busy`/`error`/`saved` above: sending a link
  // changes nothing about this person's record, so it must not disable every
  // other control in the dialog or get stomped by the next act() refetch.
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkSent, setLinkSent] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkEmailId, setLinkEmailId] = useState<number | ''>('');

  // Email addresses (Plans/Retire-Roster-Contact-Columns.md Phase 2) — a
  // leader manages any adult's/leader's addresses directly, unlike /profile's
  // self-only version (see person-actions.ts's header on that file). Own
  // add-address draft state, separate from `busy`/`error` above so it does
  // not fight with the Demographics form's own inputs.
  const [emails, setEmails] = useState<PersonEmailRow[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newEmailLabel, setNewEmailLabel] = useState<PersonEmailLabel>('home');

  // The editor renders what the SERVER says this person is, re-read after every
  // change. Relying on revalidatePath + router.refresh() to feed new props into
  // an already-open dialog silently failed: the writes landed, the dialog kept
  // showing its original props, and every save looked like it had done nothing.
  const [detail, setDetail] = useState<PersonDetail>(seed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const feedback = useSavePhase(); // Save standard (2026-08-24): Saving… → Done on every act()

  // Demographics form — one state object rather than 14 separate fields, so
  // re-seeding it from a fresh `detail` read is a single setState call, not
  // fourteen. Re-seeded whenever `detail` is re-read from the server (open,
  // and after any save in this dialog, including a household/role/relationship
  // change elsewhere in the same session — those also refetch `detail`).
  // Trade-off accepted: an in-progress, unsaved demographics edit would be
  // overwritten by an unrelated action's refetch. Not worth a dirty-tracking
  // guard for a dialog this short-lived; re-typing a stomped field is cheap.
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
  const demoFromFields = (fields: PersonDetail['fields']): DemoForm => ({
    firstName: str(fields.first_name),
    lastName: str(fields.last_name),
    birthdate: str(fields.birthdate),
    email: str(fields.primary_email),
    phone: str(fields.primary_phone),
    addr1: str(fields.address_line1),
    addr2: str(fields.address_line2),
    city: str(fields.city),
    state: str(fields.state),
    zip: str(fields.zip),
    bsaMemberId: str(fields.bsa_member_id),
    yptCompleted: str(fields.ypt_completed),
    healthFormDate: str(fields.health_form_date),
    thingsWeShouldKnow: str(fields.things_we_should_know)
  });
  const [demo, setDemo] = useState<DemoForm>(demoFromFields(seed.fields));

  // The editor is mounted only while open — showModal() once on mount puts
  // the native <dialog> in the top layer (Esc + backdrop close come free).
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = dialogRef.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);

  // Fresh read on open, so a dialog opened after someone else's edit is current.
  useEffect(() => {
    let live = true;
    Promise.all([getPersonDetail(person.person_id), getPersonEmails(person.person_id)])
      .then(([d, e]) => { if (live) { setDetail(d); setEmails(e); } })
      .catch(() => {});
    return () => { live = false; };
  }, [person.person_id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDemo(demoFromFields(detail.fields));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.fields]);

  function setDemoField<K extends keyof DemoForm>(key: K, value: DemoForm[K]) {
    setDemo((d) => ({ ...d, [key]: value }));
  }

  function saveDemographics() {
    const fd = new FormData();
    fd.set('first_name', demo.firstName);
    fd.set('last_name', demo.lastName);
    fd.set('birthdate', demo.birthdate);
    fd.set('primary_email', demo.email);
    fd.set('primary_phone', demo.phone);
    fd.set('address_line1', demo.addr1);
    fd.set('address_line2', demo.addr2);
    fd.set('city', demo.city);
    fd.set('state', demo.state);
    fd.set('zip', demo.zip);
    fd.set('bsa_member_id', demo.bsaMemberId);
    fd.set('ypt_completed', demo.yptCompleted);
    fd.set('health_form_date', demo.healthFormDate);
    fd.set('things_we_should_know', demo.thingsWeShouldKnow);
    act(() => updatePersonDemographics(person.person_id, fd), 'Demographics saved.');
  }

  function sendLink() {
    setLinkBusy(true);
    setLinkSent(null);
    setLinkError(null);
    sendSignInLink(person.person_id, linkEmailId === '' ? undefined : linkEmailId)
      .then((res) => {
        if (res.ok) {
          setLinkSent(`Link sent to ${res.masked} — good for ${res.expiresMinutes} minutes.`);
        } else {
          setLinkError(SEND_LINK_REASON[res.reason]);
        }
      })
      .catch(() => setLinkError('Something went wrong.'))
      .finally(() => setLinkBusy(false));
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMessage: string) {
    setError(null);
    setSaved(null);
    setBusy(true);
    feedback.start();
    fn()
      .then(async (res) => {
        if (!res.ok) { feedback.fail(); setError(res.error ?? 'Something went wrong.'); return; }
        // Also refreshed here, not just after an Email addresses action: a
        // Demographics save can change primary_email, and the two-way trigger
        // on person_emails means that changes the primary ROW too.
        const [freshDetail, freshEmails] = await Promise.all([
          getPersonDetail(person.person_id),
          getPersonEmails(person.person_id)
        ]);
        setDetail(freshDetail);
        setEmails(freshEmails);
        setSaved(okMessage);
        feedback.done();
        onChanged();
      })
      .catch((e) => { feedback.fail(); setError(e instanceof Error ? e.message : 'Something went wrong.'); })
      .finally(() => setBusy(false));
  }

  function addEmail() {
    const email = newEmail.trim();
    if (!email) return;
    act(() => addPersonEmailAction(person.person_id, email, newEmailLabel), 'Address added.');
    setNewEmail('');
    setNewEmailLabel('home');
  }

  const disabled = busy;
  // What's actually on record server-side (detail.fields, refreshed after
  // every save) — not `demo.email`, which can hold an unsaved keystroke.
  // Matches what requestChallengeForPerson() will actually find.
  const rosterEmail = typeof detail.fields.primary_email === 'string' ? detail.fields.primary_email.trim() : '';
  const deliverableEmails = emails.filter((e) => !e.bouncedAt && !e.unsubscribedAt);
  const householdId = detail.householdId;
  const current = detail.roles.filter((r) => !r.end_date);
  const ended = detail.roles.filter((r) => r.end_date);
  const relationships = detail.relationships;

  return (
    // Shared Dialog (Phase B, 2026-08-21) — was a hand-rolled fixed overlay
    // with no Escape/backdrop-close/focus trap (Section 2 finding #1); the
    // native <dialog> gives all three for free. Mounted only while open, so
    // showModal() runs once on mount.
    <Dialog ref={dialogRef} className={styles.editorDialog} onClose={onClose}>
      <SaveFeedback phase={feedback.phase} />
      <div className={styles.editorPanel}>
        <div className={styles.editorHead}>
          <div>
            <h2>{person.display_name}</h2>
            <p className={styles.editorSub}>
              {person.tab === 'leader' ? 'Leader' : 'Adult'}
              {person.scout_id && ` · former scout ${person.scout_id}`}
              {person.bsa_member_id && ` · BSA ${person.bsa_member_id}`}
            </p>
          </div>
          <div className={styles.inlineRow}>
            {/* Only shown with a real choice to make — one address is the
                common case, and defaulting the select to "primary" (linkEmailId
                stays '') already sends there with no extra control needed. */}
            {deliverableEmails.length > 1 && (
              <select
                className={styles.select}
                aria-label="Send to"
                disabled={linkBusy}
                // Reflects what sendLink() will actually use: linkEmailId
                // when the leader picked one, otherwise whichever address
                // requestChallengeForPerson() defaults to (the primary).
                value={linkEmailId !== '' ? linkEmailId : (deliverableEmails.find((e) => e.isPrimary)?.id ?? deliverableEmails[0]?.id ?? '')}
                onChange={(e) => setLinkEmailId(e.target.value ? Number(e.target.value) : '')}
              >
                {deliverableEmails.map((em) => (
                  <option key={em.id} value={em.id}>
                    {em.email}
                    {em.isPrimary ? ' (primary)' : ''}
                  </option>
                ))}
              </select>
            )}
            <Button
              size="sm"
              disabled={linkBusy || !rosterEmail}
              title={rosterEmail ? undefined : 'Add an email address first'}
              onClick={sendLink}
            >
              {linkBusy ? 'Sending…' : 'Send sign-in link'}
            </Button>
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        {linkSent && <div className={styles.savedNote}>{linkSent}</div>}
        {linkError && <Notice>{linkError}</Notice>}

        {error && <Notice>{error}</Notice>}
        {saved && <div className={styles.savedNote}>{saved}</div>}

        {/* A family can propose changes to an adult's own record from
            /profile now, not just their scouts' — this is where a leader sees
            and applies them. Renders nothing when there's nothing pending. */}
        <PendingUpdatePanel
          scoutId={String(person.person_id)}
          entityType="adult"
          currentValues={detail.fields}
          onApplied={() => {
            getPersonDetail(person.person_id).then(setDetail).catch(() => {});
            onChanged();
          }}
        />

        {/* "A family added this person" — a notice, not a proposal. Separate
            panel because the two can coexist: someone added last week may
            already have a pending demographic edit. */}
        <PendingUpdatePanel
          scoutId={String(person.person_id)}
          entityType="adult_added"
          currentValues={{}}
          onApplied={onChanged}
        />

        {currentTab && detail.tab !== currentTab && (
          <div className={styles.savedNote}>
            {person.display_name} now appears under{' '}
            {detail.tab === 'leader' ? 'Leaders' : detail.tab === 'adult' ? 'Adults' : detail.tab}.
          </div>
        )}

        <section className={styles.editorSection}>
          <h3 className="adminLabel">Status</h3>
          <p className={styles.editorHint}>
            Inactive people stay on record — they keep their ledger history, relationships and past
            events — but are no longer offered in the family signup picker. This is separate from
            roles: someone who steps down from a role is still around, still a parent, still
            offered.
          </p>
          <div className={styles.statusRadioRow}>
            <label className={styles.statusRadio}>
              <input
                type="radio"
                name={`person-status-${person.person_id}`}
                checked={detail.active && !pendingInactive}
                disabled={disabled}
                onChange={() => {
                  setPendingInactive(false);
                  if (!detail.active) {
                    act(() => setPersonActive(person.person_id, true), 'Marked active.');
                  }
                }}
              />
              <span>Active</span>
            </label>
            <label className={styles.statusRadio}>
              <input
                type="radio"
                name={`person-status-${person.person_id}`}
                checked={!detail.active || pendingInactive}
                disabled={disabled}
                onChange={() => setPendingInactive(true)}
              />
              <span>Inactive</span>
            </label>
          </div>
          {!detail.active && !pendingInactive && detail.inactiveReason && (
            <p className={styles.muted}>{detail.inactiveReason}</p>
          )}
          {detail.active && pendingInactive && (
            <div className={styles.inlineRow}>
              <input
                className={styles.searchInput}
                placeholder="Reason (optional) — moved away, aged out of the troop…"
                value={reason}
                disabled={disabled}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                size="sm"
                disabled={disabled}
                onClick={() =>
                  act(
                    () => setPersonActive(person.person_id, false, reason),
                    'Marked inactive — no longer offered at signup.'
                  )
                }
              >
                Mark inactive
              </Button>
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => setPendingInactive(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </section>

        {/* ── Demographics ──────────────────────────────────────────── */}
        <section className={styles.editorSection}>
          <h3 className="adminLabel">Demographics</h3>
          <p className={styles.editorHint}>
            Contact info, YPT and health form dates, and anything leaders should know. A family can
            also propose changes to some of this from their own /profile — those land above as a
            Pending Update rather than here, so nothing you type is ever silently overwritten by a
            family submission.
          </p>
          <FormPanel>
          <div className={fields.fieldGrid}>
            <label className={fields.editField}>
              <span className={fields.editLabel}>First Name</span>
              <input
                className={fields.editInput}
                value={demo.firstName}
                disabled={disabled}
                onChange={(e) => setDemoField('firstName', e.target.value)}
              />
            </label>
            <label className={fields.editField}>
              <span className={fields.editLabel}>Last Name</span>
              <input
                className={fields.editInput}
                value={demo.lastName}
                disabled={disabled}
                onChange={(e) => setDemoField('lastName', e.target.value)}
              />
            </label>
            <label className={fields.editField}>
              <span className={fields.editLabel}>
                Birthdate
                {ageOn(demo.birthdate || null) !== null ? ` · age ${ageOn(demo.birthdate || null)}` : ''}
              </span>
              <DatePickerField value={demo.birthdate} onChange={(v) => setDemoField('birthdate', v)} />
            </label>
            <label className={fields.editField}>
              <span className={fields.editLabel}>Email</span>
              <input
                className={fields.editInput}
                type="email"
                value={demo.email}
                disabled={disabled}
                onChange={(e) => setDemoField('email', e.target.value)}
              />
            </label>
            <label className={fields.editField}>
              <span className={fields.editLabel}>Phone</span>
              <input
                className={fields.editInput}
                type="tel"
                value={demo.phone}
                disabled={disabled}
                onChange={(e) => setDemoField('phone', e.target.value)}
              />
            </label>
            <label className={fields.editFieldFull}>
              <span className={fields.editLabel}>Address Line 1</span>
              <input
                className={fields.editInput}
                value={demo.addr1}
                disabled={disabled}
                onChange={(e) => setDemoField('addr1', e.target.value)}
              />
            </label>
            <label className={fields.editFieldFull}>
              <span className={fields.editLabel}>Address Line 2</span>
              <input
                className={fields.editInput}
                value={demo.addr2}
                disabled={disabled}
                onChange={(e) => setDemoField('addr2', e.target.value)}
                placeholder="Apt / unit (optional)"
              />
            </label>
            <label className={fields.editField}>
              <span className={fields.editLabel}>City</span>
              <input
                className={fields.editInput}
                value={demo.city}
                disabled={disabled}
                onChange={(e) => setDemoField('city', e.target.value)}
              />
            </label>
            <label className={fields.editField}>
              <span className={fields.editLabel}>State</span>
              <input
                className={fields.editInput}
                value={demo.state}
                maxLength={2}
                disabled={disabled}
                onChange={(e) => setDemoField('state', e.target.value)}
                placeholder="WI"
              />
            </label>
            <label className={fields.editField}>
              <span className={fields.editLabel}>ZIP</span>
              <input
                className={fields.editInput}
                value={demo.zip}
                disabled={disabled}
                onChange={(e) => setDemoField('zip', e.target.value)}
              />
            </label>
            <label className={fields.editField}>
              <span className={fields.editLabel}>BSA Member ID</span>
              <input
                className={fields.editInput}
                value={demo.bsaMemberId}
                disabled={disabled}
                onChange={(e) => setDemoField('bsaMemberId', e.target.value)}
                placeholder="(optional)"
              />
            </label>
            <label className={fields.editField}>
              <span className={fields.editLabel}>
                YPT Completed
                {demo.yptCompleted
                  ? ` · ${yptStatus(demo.yptCompleted).status} (expires ${yptStatus(demo.yptCompleted).expires})`
                  : ''}
              </span>
              <DatePickerField
                value={demo.yptCompleted}
                onChange={(v) => setDemoField('yptCompleted', v)}
              />
            </label>
            <label className={fields.editField}>
              <span className={fields.editLabel}>Health Form Date</span>
              <DatePickerField
                value={demo.healthFormDate}
                onChange={(v) => setDemoField('healthFormDate', v)}
              />
            </label>
            <label className={fields.editFieldFull}>
              <span className={fields.editLabel}>Things We Should Know</span>
              <textarea
                className={fields.editInput}
                value={demo.thingsWeShouldKnow}
                disabled={disabled}
                onChange={(e) => setDemoField('thingsWeShouldKnow', e.target.value)}
                rows={3}
                placeholder="e.g. Peanut allergy (EpiPen in backpack), asthma inhaler"
              />
            </label>
          </div>
          </FormPanel>
          <div className={styles.inlineRow}>
            <DiscardButton
              dirty={JSON.stringify(demo) !== JSON.stringify(demoFromFields(detail.fields))}
              pending={disabled}
              onClick={() => setDemo(demoFromFields(detail.fields))}
            />
            <SaveButton
              dirty={JSON.stringify(demo) !== JSON.stringify(demoFromFields(detail.fields))}
              pending={disabled}
              dirtyLabel="Save demographics"
              blocked={!demo.firstName.trim() || !demo.lastName.trim()}
              blockedReason="First and last name are required"
              onClick={saveDemographics}
            />
          </div>
        </section>

        {/* ── Email addresses (Plans/Retire-Roster-Contact-Columns.md Phase 2) ── */}
        <FormSection num={1} title="Email addresses">
          <p className={styles.editorHint}>
            One-click, not a save form — add, promote or remove an address and it takes effect right
            away. The Demographics email field above still edits the same primary address; either
            place keeps the other in sync.
          </p>
          {emails.length === 0 && <p className={styles.muted}>No addresses on file.</p>}
          <ul className={styles.chipList}>
            {emails.map((em) => (
              <li key={em.id} className={styles.roleChip}>
                {em.email}
                <span className={styles.muted}>{em.label}</span>
                {em.isPrimary && <span className={styles.guardianTag}>primary</span>}
                {em.bouncedAt && <span className={styles.guardianTag}>bounced</span>}
                {em.unsubscribedAt && <span className={styles.guardianTag}>unsubscribed</span>}
                {!em.isPrimary && (
                  <button
                    className={styles.chipBtn}
                    disabled={disabled}
                    onClick={() =>
                      act(() => setPersonPrimaryEmailAction(person.person_id, em.id), 'Primary address updated.')
                    }
                  >
                    Make primary
                  </button>
                )}
                <button
                  className={styles.chipBtn}
                  disabled={disabled || emails.length <= 1 || em.isPrimary}
                  title={
                    emails.length <= 1
                      ? 'The only address on file — add another before removing this one'
                      : em.isPrimary
                        ? 'Set another address as primary first'
                        : undefined
                  }
                  onClick={() => act(() => removePersonEmailAction(person.person_id, em.id), 'Address removed.')}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className={styles.inlineRow}>
            <input
              className={styles.searchInput}
              type="email"
              placeholder="name@example.com"
              value={newEmail}
              disabled={disabled}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <select
              className={styles.select}
              value={newEmailLabel}
              disabled={disabled}
              onChange={(e) => setNewEmailLabel(e.target.value as PersonEmailLabel)}
            >
              <option value="home">home</option>
              <option value="work">work</option>
              <option value="other">other</option>
            </select>
            <Button size="sm" disabled={disabled || !newEmail.trim()} onClick={addEmail}>
              Add address
            </Button>
          </div>
        </FormSection>

        {/* ── Household ─────────────────────────────────────────────── */}
        <section className={styles.editorSection}>
          <h3 className="adminLabel">Household</h3>
          <p className={styles.editorHint}>
            Picking anyone in a household brings up the whole family at signup. Household
            membership is independent of any role — it does not change when someone starts or
            stops helping out.
          </p>
          <select
            className={styles.select}
            value={householdId ?? ''}
            disabled={disabled}
            onChange={(e) =>
              act(
                () => setHousehold(person.person_id, e.target.value ? Number(e.target.value) : null),
                e.target.value ? 'Household updated.' : 'Removed from household.'
              )
            }
          >
            <option value="">— no household —</option>
            {households.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>

          <div className={styles.inlineRow}>
            {householdId !== null &&
              (renaming ? (
                <>
                  <input
                    className={styles.searchInput}
                    value={renameLabel}
                    placeholder="e.g. Stollenwerk (Joe &amp; Mindy)"
                    disabled={disabled}
                    onChange={(e) => setRenameLabel(e.target.value)}
                  />
                  <SaveButton
                    dirty={renameLabel.trim() !== (households.find((h) => h.id === householdId)?.label ?? '')}
                    pending={disabled}
                    dirtyLabel="Save name"
                    blocked={!renameLabel.trim()}
                    blockedReason="A name is required"
                    onClick={() =>
                      act(() => renameHousehold(householdId, renameLabel), 'Household renamed.')
                    }
                  />
                  <Button size="sm" disabled={disabled} onClick={() => setRenaming(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    setRenameLabel(households.find((h) => h.id === householdId)?.label ?? '');
                    setRenaming(true);
                  }}
                >
                  Rename this household
                </Button>
              ))}
          </div>

          <div className={styles.inlineRow}>
            <input
              className={styles.searchInput}
              value={newHouseholdLabel}
              placeholder="New household name"
              disabled={disabled}
              onChange={(e) => setNewHouseholdLabel(e.target.value)}
            />
            <Button
              size="sm"
              disabled={disabled || !newHouseholdLabel.trim()}
              onClick={() =>
                act(
                  () => createHouseholdForPerson(person.person_id, newHouseholdLabel),
                  'Household created and assigned.'
                )
              }
            >
              + New household
            </Button>
          </div>
          <p className={styles.editorHint}>
            Two families can share a surname — name them apart (&ldquo;Stollenwerk (Joe &amp;
            Mindy)&rdquo;) rather than leaving two identical entries in the list.
          </p>
        </section>

        {/* ── Roles ─────────────────────────────────────────────────── */}
        <section className={styles.editorSection}>
          <h3 className="adminLabel">Roles</h3>
          <p className={styles.editorHint}>
            Holding a leader, committee, or chartered-org role is what puts someone on the Leaders
            tab. Ending it moves them back to Adults — it never touches their household or
            relationships. A merit badge counselor with no other role stays an Adult.
          </p>

          {current.length === 0 && <p className={styles.muted}>No current role.</p>}
          <ul className={styles.chipList}>
            {current.map((r) => (
              <li key={r.id} className={styles.roleChip}>
                {ROLE_LABEL[r.role] ?? r.role}
                <button
                  className={styles.chipBtn}
                  disabled={disabled}
                  onClick={() => act(() => endRole(r.id), 'Role ended — they move to Adults.')}
                >
                  End
                </button>
              </li>
            ))}
          </ul>

          {ended.length > 0 && (
            <>
              <p className={styles.editorHint}>Previously held:</p>
              <ul className={styles.chipList}>
                {ended.map((r) => (
                  <li key={r.id} className={styles.roleChipEnded}>
                    {ROLE_LABEL[r.role] ?? r.role} <span className={styles.muted}>to {fmtDate(r.end_date)}</span>
                    <button
                      className={styles.chipBtn}
                      disabled={disabled}
                      onClick={() => act(() => deleteRole(r.id), 'Role deleted.')}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className={styles.inlineRow}>
            <select
              className={styles.select}
              value={newRole}
              disabled={disabled}
              onChange={(e) => setNewRole(e.target.value as GrantableRole)}
            >
              {GRANTABLE.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => act(() => addRole(person.person_id, newRole), 'Role added.')}
            >
              Add role
            </Button>
          </div>
        </section>

        {/* ── Relationships ─────────────────────────────────────────── */}
        <section className={styles.editorSection}>
          <h3 className="adminLabel">Relationships</h3>
          <p className={styles.editorHint}>
            Relationships persist through every change of role or status — an adult can be the
            sibling of a scout, and a guardian at a different address is still a guardian.
          </p>

          {relationships.length === 0 && <p className={styles.muted}>None recorded.</p>}
          <ul className={styles.relList}>
            {relationships.map((r) => (
              <li key={r.id} className={styles.relItem}>
                <span>
                  {r.outgoing ? (
                    <>
                      <strong>{person.display_name}</strong>{' '}
                      is {RELATION_WORDS[r.type as RelationshipRow['type']] ?? r.type}{' '}
                      <strong>{r.otherName}</strong>
                    </>
                  ) : (
                    <>
                      <strong>{r.otherName}</strong>{' '}
                      is {RELATION_WORDS[r.type as RelationshipRow['type']] ?? r.type}{' '}
                      <strong>{person.display_name}</strong>
                    </>
                  )}
                  {r.isGuardian && <span className={styles.guardianTag}>guardian</span>}
                </span>
                <button
                  className={styles.chipBtn}
                  disabled={disabled}
                  onClick={() => act(() => removeRelationship(r.id), 'Relationship removed.')}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <div className={styles.inlineRow}>
            <span className={styles.relPrefix}>This person is</span>
            <select
              className={styles.select}
              value={relType}
              disabled={disabled}
              onChange={(e) => setRelType(e.target.value as RelationshipInput)}
            >
              <option value="parent_of">parent of</option>
              <option value="child_of">child of</option>
              <option value="guardian_of">guardian of</option>
              <option value="sibling_of">sibling of</option>
              <option value="emergency_contact_for">emergency contact for</option>
            </select>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={isGuardian}
                disabled={disabled}
                onChange={(e) => setIsGuardian(e.target.checked)}
              />
              has guardianship
            </label>
          </div>
          <PersonPicker
            label="…of whom"
            disabled={disabled}
            onPick={(otherId) =>
              act(
                () => addRelationship(person.person_id, otherId, relType, isGuardian),
                'Relationship saved.'
              )
            }
          />
        </section>

        {/* ── Duplicates and removal ─────────────────────────────────── */}
        <section className={styles.dangerSection}>
          <div className={`${styles.inlineRow} ${styles.inlineRowSplit}`}>
            <h3 className={`adminLabel ${styles.noMargin}`}>This is a duplicate, or should not exist</h3>
            <Button
              size="sm"
              onClick={() => setShowDanger((v) => !v)}
              aria-expanded={showDanger}
            >
              {showDanger ? 'Hide' : 'Show'}
            </Button>
          </div>
          {showDanger && (
            <>
              <p className={styles.editorHint}>
                <strong>Merging is almost always the right choice.</strong> It moves every link —
                scout, leader and parent records, household, roles, relationships — onto the person
                you keep, fills their blanks from this one, and keeps this record flagged rather than
                destroying it. Deleting keeps nothing, so anything attached here has to be re-entered
                by hand.
              </p>
              <PersonPicker
                label="Merge this person into…"
                disabled={disabled}
                onPick={(survivorId) =>
                  act(
                    () => mergePersonInto(person.person_id, survivorId),
                    'Merged. Everything moved to the person you kept.'
                  )
                }
              />

              <div className={styles.inlineRow}>
                <Button
                  variant="danger"
                  disabled={disabled}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Delete ${person.display_name} permanently?\n\n` +
                          'Their household, roles and relationships go with them. This cannot be undone, ' +
                          'and is refused outright if they still hold a scout, leader or parent record.'
                      )
                    ) {
                      return;
                    }
                    act(() => deletePerson(person.person_id), 'Deleted.');
                  }}
                >
                  Delete this person
                </Button>
                <span className={styles.editorHint}>
                  Only possible for a record nothing is attached to yet.
                </span>
              </div>
            </>
          )}
        </section>
      </div>
    </Dialog>
  );
}

function PersonPicker({
  label,
  disabled,
  onPick
}: {
  label: string;
  disabled: boolean;
  onPick: (personId: number) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<
    { id: number; display_name: string; primary_email: string | null }[]
  >([]);
  const [searching, startSearch] = useTransition();

  function search(value: string) {
    setQ(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    startSearch(async () => setResults(await searchPeople(value)));
  }

  return (
    <div className={styles.pickerBlock}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        className={styles.searchInput}
        value={q}
        placeholder="Type at least two letters"
        disabled={disabled}
        onChange={(e) => search(e.target.value)}
      />
      {searching && <span className={styles.muted}> searching…</span>}
      {picked && !q && <span className={styles.pickedTag}>✓ {picked} added</span>}
      {results.length > 0 && (
        <ul className={styles.results}>
          {results.map((p) => (
            <li key={p.id}>
              <Button
                size="sm"
                className={styles.resultRow}
                disabled={disabled}
                onClick={() => {
                  setPicked(p.display_name);
                  onPick(p.id);
                  setQ('');
                  setResults([]);
                }}
              >
                {p.display_name}
                {p.primary_email && <span className={styles.muted}> {p.primary_email}</span>}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
