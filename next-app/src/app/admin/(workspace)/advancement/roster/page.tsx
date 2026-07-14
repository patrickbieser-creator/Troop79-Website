/**
 * /admin/advancement/roster — the troop roster report (Patrick, 2026-07-13).
 *
 * LEADER-ONLY: demographics (birthdays, ages, school) are for adults, not
 * the scout-role shared login — the page gates on session.role server-side.
 *
 * Everything derived is computed here, never stored: age from birthdate,
 * grade from graduation year (Aug 1 rollover), YPT status from completion
 * date (+2 years). Includes a "turning 18 soon" callout so promotions
 * (Lookups → scout → Promote to adult) don't sneak up on anyone.
 */

import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { centralToday } from '@/lib/dates';
import type { Leader, Rank, Scout, ScoutParent } from '@/lib/supabase/types';
import { PrintButton } from './print-button';
import { ScoutsTable } from './scouts-table';
import { AdultsTable } from './adults-table';
import styles from './roster.module.css';

export const metadata = {
  title: 'Roster — Troop 79'
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${iso}T12:00:00Z`));
}

/** yyyy-mm-dd of this scout's 18th birthday. */
function eighteenth(birthdate: string): string {
  const [y, m, d] = birthdate.split('-').map(Number);
  return `${y + 18}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default async function RosterPage() {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (!session || session.role !== 'leader') {
    return (
      <div className={styles.gate}>
        The roster report is available to adult leaders only.
      </div>
    );
  }

  const supabase = createAdminClient();
  const [scoutsRes, leadersRes, ranksRes, parentsRes] = await Promise.all([
    supabase.from('scouts').select('*').eq('active', true).order('display_name'),
    supabase.from('leaders').select('*').eq('is_person', true).order('name'),
    supabase.from('ranks').select('id, display_name, sort_order'),
    supabase.from('scout_parents').select('*').order('sort_order')
  ]);

  const today = centralToday();
  const scouts = (scoutsRes.data ?? []) as Scout[];
  const allPeople = (leadersRes.data ?? []) as Leader[];
  const rankLabel = Object.fromEntries(
    ((ranksRes.data ?? []) as Rank[]).map((r) => [r.id, r.display_name])
  );
  const parentsByScout: Record<string, ScoutParent[]> = {};
  for (const p of (parentsRes.data ?? []) as ScoutParent[]) {
    (parentsByScout[p.scout_id] ??= []).push(p);
  }

  // Adults = person rows not linked to an active scout (youth initials
  // belong on the scout side of the roster).
  const activeIds = new Set(scouts.map((s) => s.id));
  const adults = allPeople.filter((l) => !(l.scout_id && activeIds.has(l.scout_id)));

  // Scouts turning 18 within six months — promotion heads-up.
  const horizon = new Date(`${today}T12:00:00Z`);
  horizon.setUTCMonth(horizon.getUTCMonth() + 6);
  const horizonIso = horizon.toISOString().slice(0, 10);
  const turning18 = scouts
    .filter((s) => s.birthdate)
    .map((s) => ({ s, on: eighteenth(s.birthdate!) }))
    .filter(({ on }) => on > today && on <= horizonIso)
    .sort((a, b) => a.on.localeCompare(b.on));

  return (
    <>
      <div className={styles.pageTitle}>
        <div>
          <h1>Troop Roster</h1>
          <p>
            {scouts.length} active scouts &middot; {adults.length}{' '}
            adults &middot; ages and grades derived from birthdate and graduation year as of{' '}
            {fmtDate(today)} &middot; leaders only
          </p>
        </div>
        <PrintButton className={styles.printBtn} />
      </div>

      {turning18.length > 0 && (
        <div className={styles.callout}>
          <strong>Turning 18 soon:</strong>{' '}
          {turning18
            .map(({ s, on }) => `${s.display_name} (${fmtDate(on)})`)
            .join(' · ')}{' '}
          — record any outstanding sign-offs, then use Promote to adult in Lookups.
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHead}>Scouts ({scouts.length})</div>
        <ScoutsTable scouts={scouts} rankLabel={rankLabel} parentsByScout={parentsByScout} today={today} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>Adults ({adults.length})</div>
        <AdultsTable adults={adults} today={today} />
      </div>
    </>
  );
}
