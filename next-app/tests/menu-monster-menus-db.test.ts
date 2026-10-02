import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { recordAuditAs } from '../src/lib/audit';

/**
 * Menu Monster scout workspace, Phase 1 schema (Plans/Menu-Monster-Scout-Workspace.md):
 * mm_menus holds a verified scout's saved menus — meals and diets as jsonb, a
 * server-built priced snapshot, an optional calendar outing. RLS on, zero
 * policies (checked with the other mm_* tables in menu-monster-db.test.ts).
 *
 * Rows are inserted for the test scout (Charlie Walters, person 39) and
 * removed after each test.
 */

const TEST_SCOUT = 39;
const MARKER = 'vitest-mm-menus';
const admin = adminClient();

function localSql(sql: string): string {
  const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1] ?? 'next-app';
  const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], {
    encoding: 'utf8'
  }).trim();
}

function menuRow(overrides: Record<string, unknown> = {}) {
  return { owner_person_id: TEST_SCOUT, name: MARKER, context: 'camp', headcount: 8, ...overrides };
}

afterEach(async () => {
  await admin.from('mm_menus').delete().eq('name', MARKER);
  await admin.from('audit_log').delete().eq('entity_type', MARKER);
});

describe('mm_menus schema', () => {
  it('MmMenus_SavesMenu_WithDefaultsForAnEmptyMenu', async () => {
    const { data, error } = await admin.from('mm_menus').insert(menuRow()).select('*').single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      owner_person_id: TEST_SCOUT,
      calendar_entry_id: null,
      start_date: null,
      restrictions: {},
      meals: [],
      snapshot: null,
      budget_per_person_meal: 4
    });
  });

  it('MmMenus_RejectsUnknownContext', async () => {
    const { error } = await admin.from('mm_menus').insert(menuRow({ context: 'boat' }));
    expect(error?.code).toBe('23514');
  });

  it('MmMenus_RejectsNegativeBudget', async () => {
    const { error } = await admin.from('mm_menus').insert(menuRow({ budget_per_person_meal: -1 }));
    expect(error?.code).toBe('23514');
  });

  it('MmMenus_RejectsBlankName', async () => {
    const { error } = await admin.from('mm_menus').insert(menuRow({ name: '   ' }));
    expect(error?.code).toBe('23514');
  });

  it('MmMenus_RejectsMealsThatAreNotAnArray', async () => {
    const { error } = await admin.from('mm_menus').insert(menuRow({ meals: { breakfast: true } }));
    expect(error?.code).toBe('23514');
  });

  it('MmMenus_KeepsMenu_WhenItsCalendarEntryIsDeleted', () => {
    // confdeltype: n = SET NULL. A leader deleting or merging an outing must not delete scouts' menus.
    const rule = localSql(
      `select confdeltype from pg_constraint where conrelid = 'public.mm_menus'::regclass and confrelid = 'public.calendar_entries'::regclass`
    );
    expect(rule).toBe('n');
  });

  it('MmMenus_BlocksDeletingAnOwnerWhoHasMenus', () => {
    // confdeltype: r = RESTRICT. Menus are never cascade-deleted with a person.
    const rule = localSql(
      `select confdeltype from pg_constraint where conrelid = 'public.mm_menus'::regclass and confrelid = 'public.people'::regclass`
    );
    expect(rule).toBe('r');
  });
});

describe('audit_log menus area', () => {
  it('Audit_AcceptsMenusArea_ForScoutActions', async () => {
    await recordAuditAs(admin, { personId: TEST_SCOUT, label: 'Charlie W.' }, {
      area: 'menus',
      action: 'create',
      entityType: MARKER,
      entityId: 'x',
      summary: 'Charlie W. created menu "Test"'
    });
    const { data } = await admin.from('audit_log').select('area, actor_person_id').eq('entity_type', MARKER);
    expect(data).toEqual([{ area: 'menus', actor_person_id: TEST_SCOUT }]);
  });
});
