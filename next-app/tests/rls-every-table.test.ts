import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * The every-table RLS guard (Supabase security posture, 2026-08-25, D-051 / D-239; the tech-lead's P4 spec asked for
 * it with Meeting Live's new tables). Read from the local database's catalog, so a table added by any migration is
 * covered the day it lands:
 *
 *   1. every table in public has row level security on (no exceptions: a table without it is readable with the anon
 *      key the moment someone grants it);
 *   2. the meeting board's and planner's tables (meeting_* and focus_*, except the legacy published-agenda tables
 *      meetings / meeting_sessions / meeting_plans, which keep their public read policy) are service-role only:
 *      zero policies and no table privilege at all for anon or authenticated.
 */
function localSql(sql: string): string {
  const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1] ?? 'next-app';
  const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], { encoding: 'utf8' }).trim();
}

const LEGACY_PUBLIC = ['meeting_sessions', 'meeting_plans'];
const plannerTables = () =>
  localSql(
    `select string_agg(c.relname, ',' order by c.relname) from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
        and (c.relname like 'meeting\\_%' or c.relname like 'focus\\_%')
        and c.relname not in (${LEGACY_PUBLIC.map((t) => `'${t}'`).join(', ')})`
  )
    .split(',')
    .filter(Boolean);

describe('row level security', () => {
  it('EveryPublicTable_HasRowLevelSecurityOn', () => {
    expect(localSql(`select coalesce(string_agg(relname, ',' order by relname), '') from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity`)).toBe('');
  });

  it('PlannerIIITables_AreCoveredByTheGuard', () => {
    expect(['meeting_scout_roles', 'meeting_night_badges', 'meeting_plan_snapshots', 'meeting_plan_pages', 'meeting_live_presence', 'meeting_boards', 'focus_sets'].every((t) => plannerTables().includes(t))).toBe(true);
  });

  it('PlannerTables_HaveNoPolicies', () => {
    const list = plannerTables().map((t) => `'${t}'`).join(', ');
    expect(localSql(`select coalesce(string_agg(tablename, ','), '') from pg_policies where schemaname = 'public' and tablename in (${list})`)).toBe('');
  });

  it('PlannerTables_GrantNothingToAnonOrAuthenticated', () => {
    const list = plannerTables().map((t) => `'${t}'`).join(', ');
    const privs = ['select', 'insert', 'update', 'delete'];
    const leaks = localSql(
      `select coalesce(string_agg(distinct c.relname || ':' || r || ':' || p, ','), '') from pg_class c
        cross join unnest(array['anon', 'authenticated']) r
        cross join unnest(array[${privs.map((p) => `'${p}'`).join(', ')}]) p
        where c.relnamespace = 'public'::regnamespace and c.relname in (${list}) and has_table_privilege(r, c.oid, p)`
    );
    expect(leaks).toBe('');
  });
});
