import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordLoginEvent } from '../src/lib/login-events';

/**
 * The login log's role snapshot (Recent Logins dashboard): a Meeting Planner right alone does not make someone a
 * leader (Plans/Meeting-Planner-II.md, Decision 3; qa-lead 2026-10-21).
 */

function fakeClient(capabilities: string[]) {
  const inserted: Record<string, unknown>[] = [];
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'limit']) c[m] = () => c;
    c.then = (resolve: (v: unknown) => void) => resolve(result);
    return c;
  };
  const client = {
    from(table: string) {
      if (table === 'person_capabilities') return chain({ data: capabilities.map((capability) => ({ capability })) });
      return {
        ...chain({ count: 3 }),
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row);
          return { error: null };
        }
      };
    }
  };
  return { client: client as unknown as SupabaseClient, inserted };
}

describe('recordLoginEvent role snapshot', () => {
  it('PlannerViewOnly_IsLoggedAsFamily', async () => {
    const { client, inserted } = fakeClient(['meeting_planner.view']);
    await recordLoginEvent(client, { personId: 7, method: 'link', success: true });
    expect(inserted[0]?.role_snapshot).toBe('family');
  });

  it('AnyLeaderRight_IsLoggedAsLeader', async () => {
    const { client, inserted } = fakeClient(['meeting_planner.view', 'news.write']);
    await recordLoginEvent(client, { personId: 7, method: 'link', success: true });
    expect(inserted[0]?.role_snapshot).toBe('leader');
  });
});
