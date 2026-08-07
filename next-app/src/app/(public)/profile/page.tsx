import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { loadHouseholdByKey } from '@/lib/households';
import { EDITABLE_SCOUT_FIELDS, type ChangeRequestRow } from '@/lib/change-requests';
import { submitChangeRequestAction } from './actions';
import ProfileEditor, { type ScoutProfileFields } from './profile-editor';
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

export default async function ProfilePage({
  searchParams
}: {
  searchParams: Promise<{
    err?: string;
    submitted?: string;
    nochange?: string;
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

  let scouts: ScoutProfileFields[] = [];
  let householdHasNoScouts = false;
  let householdLabel = '';
  const pendingByScout = new Map<string, ChangeRequestRow>();

  if (state === 'ready' && session) {
    const household = await loadHouseholdByKey(session.householdKey);
    householdLabel = household?.label ?? session.displayName;
    const scoutIds = household?.scouts.map((s) => s.id) ?? [];
    householdHasNoScouts = scoutIds.length === 0;

    if (scoutIds.length > 0) {
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
