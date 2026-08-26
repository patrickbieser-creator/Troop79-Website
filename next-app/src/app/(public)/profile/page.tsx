import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { loadHouseholdByKey, storedHouseholdId } from '@/lib/households';
import {
  EDITABLE_SCOUT_FIELDS,
  EDITABLE_PERSON_FIELDS,
  type ChangeRequestRow
} from '@/lib/change-requests';
import {
  submitChangeRequestAction,
  submitPersonChangeRequestAction,
  withdrawChangeRequestAction,
  addHouseholdMemberAction,
  addAdultEmailAction,
  setAdultPrimaryEmailAction,
  removeAdultEmailAction
} from './actions';
import { type ScoutProfileFields } from './profile-editor';
import { type AdultProfileFields } from './adult-editor';
import HouseholdMembers, { type HouseholdMemberView } from './household-members';
import { listPersonEmails, type PersonEmailRow } from '@/lib/person-emails';
import styles from './profile.module.css';

/*
 * /profile — family self-service demographics (Plans/Scout-Self-Service-Demographics.md),
 * now Tier 2 (Plans/Family-Identity-Auth.md Phase 2). The self-asserted
 * household picker is GONE — a verified adult session already carries its
 * household (resolved once at redemption, in the signed cookie), so there is
 * nothing left to pick. A visitor with no verified session sees a sign-in
 * prompt instead of the old troop-password gate; a verified SCOUT session
 * (Tier 2-S) sees a clear explanation, not a redirect loop — it grants proof
 * submission only, never demographics.
 */

export const metadata: Metadata = { title: 'Profile — Troop 79' };

interface ScoutFieldRow {
  id: string;
  display_name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  school: string | null;
  graduation_year: number | null;
  swim_class: string | null;
  birthdate: string | null;
  things_we_should_know: string | null;
}

interface PersonFieldRow {
  id: number;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  birthdate: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export default async function ProfilePage({
  searchParams
}: {
  searchParams: Promise<{
    err?: string;
    submitted?: string;
    nochange?: string;
    withdrawn?: string;
    added?: string;
    emailSaved?: string;
    /** `scout:<id>` or `person:<personId>` — which member to open. */
    member?: string;
  }>;
}) {
  const sp = await searchParams;
  const session = await getIdentitySessionIfValid();

  const supabase = createAdminClient();
  const epochOk = session ? await isEpochCurrent(supabase, session) : false;

  const state: 'anon' | 'scout-blocked' | 'revoked' | 'ready' = !session
    ? 'anon'
    : !epochOk
      ? 'revoked'
      : session.subjectKind === 'scout'
        ? 'scout-blocked'
        : 'ready';

  // Everything the member switcher needs, keyed the way it selects: a member
  // key is `scout:<id>` or `person:<personId>`, which is also what ?member=
  // carries back after a submit.
  const members: HouseholdMemberView[] = [];
  const scoutsByKey: Record<string, ScoutProfileFields> = {};
  const adultsByKey: Record<string, AdultProfileFields> = {};
  const pendingByKey: Record<string, ChangeRequestRow> = {};
  let householdEmpty = false;
  let householdLabel = '';
  let canAddMember = false;
  let selfEmails: PersonEmailRow[] = [];

  if (state === 'ready' && session) {
    const household = await loadHouseholdByKey(session.householdKey);
    householdLabel = household?.label ?? session.displayName;
    const scoutIds = household?.scouts.map((s) => s.id) ?? [];
    const adultPersonIds = household?.adults.map((a) => a.personId) ?? [];
    householdEmpty = scoutIds.length === 0 && adultPersonIds.length === 0;

    // A stored household is the only requirement now. The extra "and it has a
    // scout" test went with scout_parents (D-066) — that column was the only
    // reason add_parent_to_household needed one, and requiring it hid this
    // form from any family whose scouts had all aged out.
    canAddMember = storedHouseholdId(household?.key) != null;
    selfEmails = await listPersonEmails(supabase, session.personId);

    const [{ data: scoutRows }, { data: personRows }, { data: pendingRows }] = await Promise.all([
      scoutIds.length > 0
        ? supabase
            .from('scouts')
            .select(`id, display_name, ${EDITABLE_SCOUT_FIELDS.join(', ')}`)
            .in('id', scoutIds)
        : Promise.resolve({ data: [] }),
      adultPersonIds.length > 0
        ? supabase
            .from('people')
            .select(`id, display_name, ${EDITABLE_PERSON_FIELDS.join(', ')}`)
            .in('id', adultPersonIds)
        : Promise.resolve({ data: [] }),
      // One query for both entity types — the (entity_type, entity_id) pairs
      // can't collide, since a scout id is text like 'jsmith' and an adult's
      // is a stringified people.id.
      scoutIds.length + adultPersonIds.length > 0
        ? supabase
            .from('change_requests')
            .select('*')
            .eq('status', 'pending')
            .in('entity_id', [...scoutIds, ...adultPersonIds.map(String)])
            .in('entity_type', ['scout', 'adult'])
        : Promise.resolve({ data: [] })
    ]);

    for (const row of (pendingRows ?? []) as ChangeRequestRow[]) {
      pendingByKey[`${row.entity_type === 'adult' ? 'person' : 'scout'}:${row.entity_id}`] = row;
    }

    for (const r of (scoutRows ?? []) as unknown as ScoutFieldRow[]) {
      const key = `scout:${r.id}`;
      scoutsByKey[key] = {
        id: r.id,
        displayName: r.display_name,
        address_line1: r.address_line1,
        address_line2: r.address_line2,
        city: r.city,
        state: r.state,
        zip: r.zip,
        phone: r.phone,
        email: r.email,
        school: r.school,
        graduation_year: r.graduation_year,
        swim_class: r.swim_class,
        birthdate: r.birthdate,
        things_we_should_know: r.things_we_should_know
      };
      members.push({
        key,
        name: r.display_name,
        role: 'Scout',
        kind: 'scout',
        hasPending: key in pendingByKey
      });
    }

    const relationshipByPerson = new Map(
      (household?.adults ?? []).map((a) => [a.personId, a.relationship])
    );
    for (const r of (personRows ?? []) as unknown as PersonFieldRow[]) {
      const key = `person:${r.id}`;
      adultsByKey[key] = {
        personId: r.id,
        displayName: r.display_name,
        relationship: relationshipByPerson.get(r.id) ?? null,
        first_name: r.first_name,
        last_name: r.last_name,
        birthdate: r.birthdate,
        primary_email: r.primary_email,
        primary_phone: r.primary_phone,
        address_line1: r.address_line1,
        address_line2: r.address_line2,
        city: r.city,
        state: r.state,
        zip: r.zip
      };
      members.push({
        key,
        name: r.display_name,
        role: relationshipByPerson.get(r.id) || 'Adult',
        kind: 'adult',
        hasPending: key in pendingByKey
      });
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Profile</h1>
        <p className={styles.dek}>
          Update contact info for anyone in your household — scouts and grown-ups — and the things
          leaders should know. Changes are reviewed before they take effect.
        </p>
      </header>

      {sp.submitted === '1' && (
        <p className={styles.savedNote}>
          ✓ Your update was submitted for review. It stays on the form below until a leader
          approves it.
        </p>
      )}
      {sp.nochange === '1' && (
        <p className={styles.savedNote}>Nothing changed — no update was submitted.</p>
      )}
      {sp.withdrawn === '1' && (
        <p className={styles.savedNote}>
          ✓ Your pending update was removed from the queue. Nothing on the record changed.
        </p>
      )}
      {sp.added && (
        <p className={styles.savedNote}>
          ✓ {decodeURIComponent(sp.added)} was added to your household.
        </p>
      )}
      {sp.emailSaved === '1' && <p className={styles.savedNote}>✓ Your email addresses were updated.</p>}
      {sp.err && <p className={styles.errNote}>{decodeURIComponent(sp.err)}</p>}

      {state === 'ready' && (
        <div className={styles.loggedInBar}>
          <span>
            Signed in as <strong>{session!.displayName}</strong> ({householdLabel} household)
          </span>
        </div>
      )}

      {state === 'anon' && (
        <div className={styles.gate}>
          <p className={styles.gateLede}>
            No password to remember — sign in with your email to update your scout&rsquo;s
            information. We&rsquo;ll send you a one-time code and link.
          </p>
          <Link className={styles.gateBtn} href={`/signin?next=${encodeURIComponent('/profile')}`}>
            Sign In
          </Link>
        </div>
      )}

      {state === 'revoked' && (
        <p className={styles.errNote}>
          Your sign-in has been revoked — please{' '}
          <Link href={`/signin?next=${encodeURIComponent('/profile')}`}>sign in again</Link>.
        </p>
      )}

      {state === 'scout-blocked' && (
        <p className={styles.errNote}>
          This scout login can submit proof of completion in the{' '}
          <Link href="/library">Resource Library</Link>, but not profile updates — those need a
          parent or guardian to sign in.
        </p>
      )}

      {state === 'ready' && householdEmpty && (
        <p className={styles.dek}>
          Nobody is linked to this household yet — ask a leader if this looks wrong.
        </p>
      )}

      {state === 'ready' && !householdEmpty && (
        <HouseholdMembers
          members={members}
          scouts={scoutsByKey}
          adults={adultsByKey}
          pending={pendingByKey}
          initialKey={sp.member ?? null}
          submitScoutAction={submitChangeRequestAction}
          submitAdultAction={submitPersonChangeRequestAction}
          withdrawAction={withdrawChangeRequestAction}
          addMemberAction={addHouseholdMemberAction}
          canAddMember={canAddMember}
          selfPersonId={session?.personId ?? null}
          selfEmails={selfEmails}
          addEmailAction={addAdultEmailAction}
          setPrimaryEmailAction={setAdultPrimaryEmailAction}
          removeEmailAction={removeAdultEmailAction}
        />
      )}
    </main>
  );
}
