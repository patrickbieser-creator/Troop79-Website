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
import {
  ageOn,
  gradeFromGradYear,
  gradeLabel,
  SWIM_CLASS_LABEL,
  yptStatus
} from '@/lib/demographics';
import type { Leader, Rank, Scout } from '@/lib/supabase/types';
import { PrintButton } from './print-button';
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
  const [scoutsRes, leadersRes, ranksRes] = await Promise.all([
    supabase.from('scouts').select('*').eq('active', true).order('display_name'),
    supabase.from('leaders').select('*').eq('is_person', true).order('name'),
    supabase.from('ranks').select('id, display_name, sort_order')
  ]);

  const today = centralToday();
  const scouts = (scoutsRes.data ?? []) as Scout[];
  const allPeople = (leadersRes.data ?? []) as Leader[];
  const rankLabel = new Map(((ranksRes.data ?? []) as Rank[]).map((r) => [r.id, r.display_name]));

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
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Scout</th>
              <th>Age</th>
              <th>Birthday</th>
              <th>Grade</th>
              <th>School</th>
              <th>Patrol</th>
              <th>Rank</th>
              <th>Swim</th>
              <th>BSA ID</th>
              <th>Health Form</th>
            </tr>
          </thead>
          <tbody>
            {scouts.map((s) => {
              const age = ageOn(s.birthdate, today);
              const grade = gradeFromGradYear(s.graduation_year, today);
              return (
                <tr key={s.id}>
                  <td>{s.display_name}</td>
                  <td>{age ?? <span className={styles.muted}>—</span>}</td>
                  <td>{s.birthdate ? fmtDate(s.birthdate) : <span className={styles.muted}>—</span>}</td>
                  <td>{grade !== null ? gradeLabel(grade) : <span className={styles.muted}>—</span>}</td>
                  <td>{s.school ?? <span className={styles.muted}>—</span>}</td>
                  <td>{s.patrol ?? <span className={styles.muted}>—</span>}</td>
                  <td>{s.current_rank ? (rankLabel.get(s.current_rank) ?? s.current_rank) : '—'}</td>
                  <td>
                    {s.swim_class ? (
                      SWIM_CLASS_LABEL[s.swim_class]
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                  <td className={styles.mono}>{s.bsa_member_id ?? '—'}</td>
                  <td>{s.health_form_date ? fmtDate(s.health_form_date) : <span className={styles.muted}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>Adults ({adults.length})</div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Initials</th>
              <th>Role</th>
              <th>Age</th>
              <th>YPT</th>
              <th>BSA ID</th>
              <th>Health Form</th>
              <th>Contact</th>
            </tr>
          </thead>
          <tbody>
            {adults.map((l) => {
              const ypt = yptStatus(l.ypt_completed, today);
              return (
                <tr key={l.code}>
                  <td>{l.name}</td>
                  <td className={styles.mono}>{l.code}</td>
                  <td>{l.role ?? <span className={styles.muted}>—</span>}</td>
                  <td>{ageOn(l.birthdate, today) ?? <span className={styles.muted}>—</span>}</td>
                  <td>
                    {ypt.status === 'current' && (
                      <span className={`${styles.badge} ${styles.badgeOk}`}>thru {fmtDate(ypt.expires)}</span>
                    )}
                    {ypt.status === 'expiring' && (
                      <span className={`${styles.badge} ${styles.badgeWarn}`}>expires {fmtDate(ypt.expires)}</span>
                    )}
                    {ypt.status === 'expired' && (
                      <span className={`${styles.badge} ${styles.badgeBad}`}>expired {fmtDate(ypt.expires)}</span>
                    )}
                    {ypt.status === 'missing' && (
                      <span className={`${styles.badge} ${styles.badgeMuted}`}>not on file</span>
                    )}
                  </td>
                  <td className={styles.mono}>{l.bsa_member_id ?? '—'}</td>
                  <td>{l.health_form_date ? fmtDate(l.health_form_date) : <span className={styles.muted}>—</span>}</td>
                  <td>
                    {[l.phone, l.email].filter(Boolean).join(' · ') || (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
