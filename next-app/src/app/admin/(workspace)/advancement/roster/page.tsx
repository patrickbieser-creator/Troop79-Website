/**
 * /admin/advancement/roster — troop roster and person management.
 *
 * LEADER-ONLY: demographics (birthdays, ages, school) are for adults, not the
 * scout-role shared login — the page gates on session.role server-side, and
 * the route is absent from proxy.ts's scout allowlist (D-037).
 *
 * FOUR TABS, AND MEMBERSHIP IS DERIVED (Patrick, 2026-07-20). Active Scouts,
 * Inactive Scouts, Leaders, Adults all come from the `person_directory` view
 * rather than being computed here — the picker and the login pool need the
 * same answer, and computing it three times is how the old model drifted.
 *
 * Age-out is not inactivity: at 18 a scout is no longer a scout, so they leave
 * the scout tabs entirely and appear under Leaders or Adults depending on
 * whether they hold a role. Inactive Scouts means a youth who left — dropped
 * out, moved away, transferred.
 *
 * A person moves between Leaders and Adults by gaining or ending a role and by
 * nothing else. Their household and relationships are untouched by it.
 */

import { cookies } from 'next/headers';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { centralToday } from '@/lib/dates';
import type { Rank } from '@/lib/supabase/types';
import { PrintButton } from './print-button';
import { ScoutsTable } from './scouts-table';
import {
  PeopleTable,
  type DirectoryPerson,
  type PersonRoleRow,
  type RelationshipRow,
  type HouseholdOption
} from './people-table';
import type { ScoutRow, ParentRow } from './scout-form';
import styles from './roster.module.css';

export const metadata = {
  title: 'Roster — Troop 79'
};

type TabKey = 'active_scout' | 'inactive_scout' | 'leader' | 'adult';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'active_scout', label: 'Active Scouts' },
  { key: 'inactive_scout', label: 'Inactive Scouts' },
  { key: 'leader', label: 'Leaders' },
  { key: 'adult', label: 'Adults' }
];

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

export default async function RosterPage({
  searchParams
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (!session || session.role !== 'leader') {
    return <div className={styles.gate}>The roster is available to adult leaders only.</div>;
  }

  const { tab: tabParam } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : 'active_scout';

  const supabase = createAdminClient();
  const [
    directoryRes,
    scoutsRes,
    ranksRes,
    parentsRes,
    rolesRes,
    relsRes,
    householdsRes,
    membersRes
  ] = await Promise.all([
    supabase.from('person_directory').select('*').order('display_name'),
    supabase.from('scouts').select('*').order('display_name'),
    supabase.from('ranks').select('id, display_name, sort_order').order('sort_order'),
    supabase.from('scout_parents').select('*').order('sort_order'),
    supabase.from('person_roles').select('id, person_id, role, start_date, end_date'),
    supabase.from('relationships').select('id, person_id, related_person_id, type, is_guardian'),
    supabase.from('households').select('id, label').order('label'),
    supabase.from('household_members').select('household_id, person_id')
  ]);

  const today = centralToday();
  const directory = (directoryRes.data ?? []) as unknown as DirectoryPerson[];
  const allScouts = (scoutsRes.data ?? []) as unknown as ScoutRow[];
  const ranks = ((ranksRes.data ?? []) as Rank[]).map((r) => ({
    id: r.id,
    display_name: r.display_name
  }));
  const rankLabel = Object.fromEntries(ranks.map((r) => [r.id, r.display_name]));
  const parentsByScout: Record<string, ParentRow[]> = {};
  for (const p of (parentsRes.data ?? []) as unknown as ParentRow[]) {
    (parentsByScout[p.scout_id] ??= []).push(p);
  }

  const roles = (rolesRes.data ?? []) as unknown as PersonRoleRow[];
  const relationships = (relsRes.data ?? []) as unknown as RelationshipRow[];
  const households = (householdsRes.data ?? []) as unknown as HouseholdOption[];
  const householdByPerson: Record<number, number> = {};
  for (const m of (membersRes.data ?? []) as { household_id: number; person_id: number }[]) {
    householdByPerson[m.person_id] = m.household_id;
  }
  const nameById = Object.fromEntries(directory.map((p) => [p.person_id, p.display_name]));

  const counts = TABS.map((t) => ({
    ...t,
    n: directory.filter((p) => p.tab === t.key).length
  }));

  // Scout tabs follow the directory's classification, NOT scouts.active — an
  // aged-out scout is an adult and must not reappear here.
  const scoutIdsFor = (key: TabKey) =>
    new Set(directory.filter((p) => p.tab === key && p.scout_id).map((p) => p.scout_id as string));
  const tabScouts =
    tab === 'active_scout' || tab === 'inactive_scout'
      ? allScouts.filter((s) => scoutIdsFor(tab).has(s.id))
      : [];

  // Turning 18 within six months — a promotion heads-up, since age-out moves
  // someone off the scout roster entirely.
  const horizon = new Date(`${today}T12:00:00Z`);
  horizon.setUTCMonth(horizon.getUTCMonth() + 6);
  const horizonIso = horizon.toISOString().slice(0, 10);
  const turning18 = allScouts
    .filter((s) => s.active && s.birthdate)
    .map((s) => ({ s, on: eighteenth(s.birthdate!) }))
    .filter(({ on }) => on > today && on <= horizonIso)
    .sort((a, b) => a.on.localeCompare(b.on));

  const inactiveAdults = directory.filter(
    (p) => (p.tab === 'adult' || p.tab === 'leader') && !p.active
  ).length;

  return (
    <>
      <div className={styles.pageTitle}>
        <div>
          <h1>Troop Roster</h1>
          <p>
            Ages and grades derived from birthdate and graduation year as of {fmtDate(today)}.
            Which tab someone appears on follows their current role — giving or ending a role moves
            them, and never changes their household or relationships.
          </p>
        </div>
        <PrintButton className={styles.printBtn} />
      </div>

      <div className={styles.tabBar}>
        {counts.map((t) => (
          <Link
            key={t.key}
            href={`/admin/advancement/roster?tab=${t.key}`}
            className={tab === t.key ? styles.tabActive : styles.tab}
          >
            {t.label} ({t.n})
          </Link>
        ))}
      </div>

      {tab === 'active_scout' && turning18.length > 0 && (
        <div className={styles.callout}>
          <strong>Turning 18 soon:</strong>{' '}
          {turning18.map(({ s, on }) => `${s.display_name} (${fmtDate(on)})`).join(' · ')} — record
          any outstanding sign-offs, then open the scout and use Promote to adult. At 18 they leave
          the scout roster and appear under Leaders or Adults.
        </div>
      )}

      {(tab === 'adult' || tab === 'leader') && inactiveAdults > 0 && (
        <div className={styles.callout}>
          <strong>{inactiveAdults} people are marked inactive.</strong> They stay on record for
          history but are not offered in the family signup picker. Open one and use Mark active to
          bring them back.
        </div>
      )}

      {tab === 'active_scout' || tab === 'inactive_scout' ? (
        <ScoutsTable
          scouts={tabScouts}
          ranks={ranks}
          rankLabel={rankLabel}
          parentsByScout={parentsByScout}
          today={today}
          only={tab === 'active_scout' ? 'active' : 'inactive'}
        />
      ) : (
        <PeopleTable
          people={directory.filter((p) => p.tab === tab)}
          roles={roles}
          relationships={relationships}
          households={households}
          householdByPerson={householdByPerson}
          nameById={nameById}
        />
      )}
    </>
  );
}
