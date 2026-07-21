import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { FAMILY_COOKIE, verifyFamilySession } from '@/lib/family-session';
import { PROFILE_HOUSEHOLD_COOKIE, verifyProfileHouseholdSession } from '@/lib/profile-household-session';
import { familyGateConfigured } from '@/lib/family-access';
import { loadHouseholds, loadHouseholdByKey } from '@/lib/households';
import { EDITABLE_SCOUT_FIELDS, type ChangeRequestRow } from '@/lib/change-requests';
import {
  profileGateAction,
  pickHouseholdAction,
  profileSignOutAction,
  submitChangeRequestAction
} from './actions';
import ProfileHouseholdPicker from './profile-household-picker';
import ProfileEditor, { type ScoutProfileFields } from './profile-editor';
import styles from './profile.module.css';

/*
 * /profile — family self-service demographics (Plans/Scout-Self-Service-Demographics.md).
 * Deliberately its OWN surface, not a step inside Event Signup's household
 * picker: it's the general "manage your account" destination, reached from
 * the utility bar, and the natural home for whatever gets added here later.
 *
 * Three states on load: not logged in (password gate) → logged in but no
 * household bound yet (find yourself) → household bound ("Logged in as
 * {name}" banner + per-scout edit forms). See lib/profile-household-session.ts
 * for why the household binding is a second cookie, not a change to the
 * family gate's existing contract.
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

export default async function ProfilePage({
  searchParams
}: {
  searchParams: Promise<{
    gate?: string;
    err?: string;
    submitted?: string;
    nochange?: string;
    signedout?: string;
  }>;
}) {
  const sp = await searchParams;
  const jar = await cookies();
  const family = await verifyFamilySession(jar.get(FAMILY_COOKIE.name)?.value);
  const householdSession = family
    ? await verifyProfileHouseholdSession(jar.get(PROFILE_HOUSEHOLD_COOKIE.name)?.value)
    : null;

  const state: 'anon' | 'no-household' | 'ready' = !family
    ? 'anon'
    : householdSession
      ? 'ready'
      : 'no-household';

  let scouts: ScoutProfileFields[] = [];
  let householdHasNoScouts = false;
  const pendingByScout = new Map<string, ChangeRequestRow>();

  if (state === 'ready' && householdSession) {
    const household = await loadHouseholdByKey(householdSession.householdKey);
    const scoutIds = household?.scouts.map((s) => s.id) ?? [];
    householdHasNoScouts = scoutIds.length === 0;

    if (scoutIds.length > 0) {
      const supabase = createAdminClient();
      const [{ data: scoutRows }, { data: pendingRows }] = await Promise.all([
        supabase
          .from('scouts')
          .select(`id, display_name, ${EDITABLE_SCOUT_FIELDS.join(', ')}`)
          .in('id', scoutIds),
        supabase
          .from('change_requests')
          .select('*')
          .eq('entity_type', 'scout')
          .eq('status', 'pending')
          .in('entity_id', scoutIds)
      ]);
      scouts = ((scoutRows ?? []) as unknown as ScoutFieldRow[]).map((r) => ({
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
      }));
      for (const row of (pendingRows ?? []) as ChangeRequestRow[]) {
        pendingByScout.set(row.entity_id, row);
      }
    }
  }

  const householdsForPicker = state === 'no-household' ? await loadHouseholds() : [];

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Profile</h1>
        <p className={styles.dek}>
          Update your scout&rsquo;s contact info and things leaders should know. Changes are
          reviewed before they take effect.
        </p>
      </header>

      {sp.submitted === '1' && (
        <p className={styles.savedNote}>✓ Your update was submitted for review.</p>
      )}
      {sp.nochange === '1' && (
        <p className={styles.savedNote}>Nothing changed — no update was submitted.</p>
      )}
      {sp.signedout === '1' && <p className={styles.savedNote}>✓ Logged out on this device.</p>}
      {sp.err && <p className={styles.errNote}>{decodeURIComponent(sp.err)}</p>}

      {state !== 'anon' && (
        <div className={styles.loggedInBar}>
          <span>
            {state === 'ready' && householdSession ? (
              <>
                Logged in as <strong>{householdSession.displayName}</strong> household
              </>
            ) : (
              '✓ You’re logged in — now find yourself below.'
            )}
          </span>
          <form action={profileSignOutAction}>
            <button type="submit" className={styles.linkBtn}>
              Log out
            </button>
          </form>
        </div>
      )}

      {state === 'anon' &&
        (!familyGateConfigured() ? (
          <p className={styles.errNote}>
            The family gate isn’t configured on this server (FAMILY_PASSWORD is unset).
          </p>
        ) : (
          <form action={profileGateAction} className={styles.gate}>
            <p className={styles.gateLede}>
              One shared password for the whole troop — it’s printed in the Bugle each week, or ask
              any leader. No account, no email.
            </p>
            <label className={styles.gateLabel} htmlFor="profile-password">
              Troop password
            </label>
            <div className={styles.gateRow}>
              <input
                id="profile-password"
                name="password"
                type="password"
                autoComplete="off"
                className={styles.gateInput}
                placeholder="Enter the troop password"
              />
              <button type="submit" className={styles.gateBtn}>
                Continue
              </button>
            </div>
            {sp.gate === 'bad-password' && (
              <p className={styles.gateErr}>That password didn’t match. Try again.</p>
            )}
            {sp.gate === 'missing' && (
              <p className={styles.gateErr}>Please enter the troop password.</p>
            )}
            {sp.gate === 'not-configured' && (
              <p className={styles.gateErr}>The family gate isn’t configured on this server.</p>
            )}
          </form>
        ))}

      {state === 'no-household' && (
        <ProfileHouseholdPicker
          households={householdsForPicker}
          pickHouseholdAction={pickHouseholdAction}
        />
      )}

      {state === 'ready' && householdHasNoScouts && (
        <p className={styles.dek}>
          No scouts are linked to this household yet — ask a leader if this looks wrong.
        </p>
      )}

      {state === 'ready' &&
        scouts.map((scout) => (
          <details key={scout.id} className={styles.scoutCard} open={scouts.length === 1}>
            <summary className={styles.scoutSummary}>{scout.displayName}</summary>
            <div className={styles.scoutBody}>
              <ProfileEditor
                scout={scout}
                pending={pendingByScout.get(scout.id) ?? null}
                submitAction={submitChangeRequestAction}
              />
            </div>
          </details>
        ))}
    </main>
  );
}
