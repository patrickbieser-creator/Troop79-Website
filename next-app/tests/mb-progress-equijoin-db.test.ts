import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * mb_progress was a nested loop over `code like (m.id || '-%')` (~66 ms in prod). It now equi-joins
 * merit_badges.id to the code's hyphen prefixes. The answer must not change — the 2026-07-19 fix for
 * hyphenated badge ids ('first-aid-2a') is the thing most likely to regress.
 */
function localSql(sql: string): string {
  const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1] ?? 'next-app';
  const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], {
    encoding: 'utf8'
  }).trim();
}

// The 20260719060000 definition, verbatim, as a session-local view to compare against.
const OLD = `
create temp view old_mb_progress as
  with awards as (
    select scout_id, substring(code from 4) as mb_id from public.ledger_active
    where kind = 'merit_badge_award' and code like 'MB:%'
  ),
  req_matches as (
    select l.scout_id, m.id as mb_id,
      row_number() over (partition by l.scout_id, l.code order by length(m.id) desc) as rn
    from public.ledger_active l join public.merit_badges m on l.code like (m.id || '-%')
    where l.kind = 'merit_badge_requirement'
  ),
  reqs as (select scout_id, mb_id from req_matches where rn = 1),
  combined as (
    select scout_id, mb_id, true as has_award, false as has_req from awards
    union all select scout_id, mb_id, false, true from reqs
  )
  select mb_id, scout_id, bool_or(has_award) as awarded, bool_or(has_req) as has_any_req
  from combined group by mb_id, scout_id;`;

describe('mb_progress equi-join', () => {
  it('View_HasNoLikeJoinOnBadgeId', () => {
    const def = localSql(`select pg_get_viewdef('public.mb_progress'::regclass)`);
    expect(def).not.toMatch(/~~\s*\(m\.id/);
  });

  it('View_MatchesTheLikeJoinDefinition_BothDirections', () => {
    const out = localSql(
      `${OLD} select (select count(*) from (select * from old_mb_progress except select * from public.mb_progress) a) || ',' || (select count(*) from (select * from public.mb_progress except select * from old_mb_progress) b)`
    );
    expect(out.split('\n').pop()).toBe('0,0');
  });

  it('View_StillResolvesHyphenatedBadgeIds', () => {
    const n = Number(
      localSql(
        `select count(*) from public.mb_progress p join public.merit_badges m on m.id = p.mb_id where p.mb_id like '%-%'`
      )
    );
    expect(n).toBeGreaterThan(0);
  });

  it('View_KeepsSecurityInvokerAndRowsExist', () => {
    expect(localSql(`select reloptions::text from pg_class where oid = 'public.mb_progress'::regclass`)).toContain('security_invoker=true');
  });
});
