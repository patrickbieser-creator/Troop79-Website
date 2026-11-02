import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

/**
 * The database refuses any date or timestamp before 1900 (Patrick, 2026-11-01), so a CSV import, a script or a
 * server action can't slip one past the form fields' own check. A new date column must carry the rule too; this
 * test names any that doesn't. Read-only catalog queries and a rolled-back insert: nothing is left behind.
 */
function psql(sql: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync('docker', ['exec', '-i', 'supabase_db_next-app', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, out: out.toString() };
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer };
    return { ok: false, out: `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}` };
  }
}

describe('the 1900 floor in the database', () => {
  it('EveryDateAndTimestampColumn_HasTheRule', () => {
    const { out } = psql(`
      select c.table_name || '.' || c.column_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and c.data_type in ('date', 'timestamp with time zone', 'timestamp without time zone')
        and not exists (
          select 1 from pg_constraint k
          where k.conrelid = format('public.%I', c.table_name)::regclass and k.contype = 'c'
            and k.conname = left(c.column_name || '_from_1900', 63)
        )
      order by 1;`);
    expect(out.trim().split('\n').filter(Boolean)).toEqual([]);
  });

  it('ALedgerDateBefore1900_IsRefused', () => {
    const run = psql(`
      begin;
      insert into public.ledger_entries (scout_id, date, kind, code) select id, date '0025-11-08', 'rank_requirement', 'scout-1a' from public.scouts limit 1;
      rollback;`);
    expect(run.out).toMatch(/date_from_1900/);
  });

  it('ABirthdateBefore1900_IsRefused', () => {
    const run = psql(`
      begin;
      update public.people set birthdate = date '0991-09-25' where id = (select min(id) from public.people);
      rollback;`);
    expect(run.out).toMatch(/birthdate_from_1900/);
  });
});
