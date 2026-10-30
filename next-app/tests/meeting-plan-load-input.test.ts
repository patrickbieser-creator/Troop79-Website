import { describe, it, expect, vi } from 'vitest';
import { loadEngineInput } from '../src/lib/meeting-suggest/load-input';
import { buildMeetingPlan } from '../src/lib/meeting-suggest/engine';

/** The engine's loader against the real local database, after the Phase 0a re-key: teachers come from teaching_skills. */
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

describe('loadEngineInput', () => {
  it('LoadEngineInput_ReadsTeachersByPerson_AndBuildsAPlan', async () => {
    const res = await loadEngineInput('2026-10-25', 'Vitest');
    if (!res.ok) throw new Error(res.error);
    const adultIds = new Set(res.input.adults.map((a) => a.personId));
    const scoutPersonIds = new Set(res.input.scouts.map((s) => s.person_id));
    // Every adult is a person who teaches or counsels, and never an active scout.
    expect([...adultIds].filter((id) => scoutPersonIds.has(id))).toEqual([]);
    expect(buildMeetingPlan(res.input).version).toBe(1);
  });
});
