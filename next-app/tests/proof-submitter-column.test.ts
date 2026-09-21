import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { loadPendingSubmission } from '../src/lib/library-data';

/**
 * `requirement_submissions.submitted_by_person_id` (migration 20260920210000).
 *
 * The table recorded WHOSE requirement a claim was about and roughly how it
 * arrived, but never WHO pressed submit — so there was nobody to tell when a
 * leader approved or returned it. A leader filing by proxy was recorded only
 * as a "Filed by …" line inside `body_md`, which is prose for a human and
 * must never be parsed back into an identity.
 *
 * `submitProofAction` itself needs a request/cookie harness this suite does
 * not have (the boundary documented in tests/submit-proof-tier2.test.ts,
 * D-049; Patrick confirmed 2026-09-20 that the current approach is
 * sufficient), so what is pinned here is the column's CONTRACT — the shape
 * the action writes against and the review notice reads back:
 *   - it accepts a real person and hands them back on the pending row;
 *   - it is nullable, and null means "unknown", never a fallback to someone
 *     else;
 *   - it is a real FK, so a bad id fails loudly at write time rather than
 *     silently addressing a notice to nobody.
 *
 * Real local Postgres, no mocks. Fixtures carry the `zz-sub` prefix.
 */

const SCOUT = 'zz-sub-scout';
const TARGET_KEY = 'zz-sub-first-class-7d';

type Admin = ReturnType<typeof adminClient>;
let admin: Admin;
let personId: number;

const row = (over: Record<string, unknown> = {}) => ({
  scout_id: SCOUT,
  target_kind: 'rank_req',
  target_key: TARGET_KEY,
  proof_type: 'report',
  body_md: 'Did the thing.',
  media: [],
  submitted_via: 'scout',
  status: 'pending',
  ...over
});

const clean = async () => {
  await admin.from('requirement_submissions').delete().eq('target_key', TARGET_KEY);
};

beforeAll(async () => {
  admin = adminClient();
  await clean();
  await admin.from('scouts').delete().eq('id', SCOUT);

  const { data: person, error: personErr } = await admin
    .from('people')
    .insert({ first_name: '[TEST]', last_name: 'Submitter', display_name: '[TEST] Submitter' })
    .select('id')
    .single();
  if (personErr) throw new Error(`fixture person: ${personErr.message}`);
  personId = person!.id;

  const { error } = await admin.from('scouts').insert({
    id: SCOUT,
    first_name: '[TEST]',
    last_name: 'Sub Scout',
    display_name: '[TEST] Sub Scout',
    active: true
  });
  if (error) throw new Error(`fixture scout: ${error.message}`);
});

beforeEach(clean);

afterAll(async () => {
  await clean();
  await admin.from('scouts').delete().eq('id', SCOUT);
  await admin.from('people').delete().eq('id', personId);
});

describe('requirement_submissions.submitted_by_person_id', () => {
  it('records the person who pressed submit and reads back on the pending claim', async () => {
    const { error } = await admin
      .from('requirement_submissions')
      .insert(row({ submitted_by_person_id: personId }));
    expect(error).toBeNull();

    const pending = await loadPendingSubmission(admin, SCOUT, 'rank_req', TARGET_KEY);
    expect(pending).not.toBeNull();

    const { data } = await admin
      .from('requirement_submissions')
      .select('submitted_by_person_id')
      .eq('id', pending!.id)
      .single();
    expect(data!.submitted_by_person_id).toBe(personId);
  });

  it('accepts null — an unresolvable submitter is unknown, not somebody else', async () => {
    const { error } = await admin
      .from('requirement_submissions')
      .insert(row({ submitted_by_person_id: null }));
    expect(error).toBeNull();
  });

  it('rejects a person who does not exist rather than storing a dangling id', async () => {
    const { error } = await admin
      .from('requirement_submissions')
      .insert(row({ submitted_by_person_id: 2147483000 }));
    expect(error?.code).toBe('23503');
  });

  it('carries the submitter through a redo, so the latest sender is the one notified', async () => {
    await admin.from('requirement_submissions').insert(row({ submitted_by_person_id: null }));
    const pending = await loadPendingSubmission(admin, SCOUT, 'rank_req', TARGET_KEY);

    // What the action's replace-in-place branch does when a different
    // household member sends a better answer for the same requirement.
    const { error } = await admin
      .from('requirement_submissions')
      .update({ body_md: 'A better answer.', submitted_by_person_id: personId })
      .eq('id', pending!.id)
      .eq('status', 'pending');
    expect(error).toBeNull();

    const { data } = await admin
      .from('requirement_submissions')
      .select('submitted_by_person_id, body_md')
      .eq('id', pending!.id)
      .single();
    expect(data!.submitted_by_person_id).toBe(personId);
    expect(data!.body_md).toBe('A better answer.');
  });
});

/**
 * The review call sites themselves (qa-lead, 2026-09-20: the four wirings
 * were exercised nowhere). `approveSubmission`/`returnSubmission` take a
 * client, so they run here for real; the notification inside them is
 * best-effort and inert under vitest (tests/email-no-send-in-tests.test.ts),
 * so what is proven is that the DECISION still lands and that a submission
 * with no resolvable submitter does not derail it.
 */
describe('review call sites survive an unsendable notice', () => {
  it('returns a submission and keeps the feedback, with no submitter recorded', async () => {
    const { returnSubmission } = await import('../src/lib/library-data');
    await admin.from('requirement_submissions').insert(row({ submitted_by_person_id: null }));
    const pending = await loadPendingSubmission(admin, SCOUT, 'rank_req', TARGET_KEY);

    const err = await returnSubmission(admin, pending!.id, '[TEST] Leader', 'Add the date.');
    expect(err).toBeNull();

    const { data } = await admin
      .from('requirement_submissions')
      .select('status, feedback_md')
      .eq('id', pending!.id)
      .single();
    expect(data!.status).toBe('returned');
    expect(data!.feedback_md).toBe('Add the date.');
  });

  it('refuses to return a claim another leader already decided', async () => {
    const { returnSubmission } = await import('../src/lib/library-data');
    await admin.from('requirement_submissions').insert(row({ submitted_by_person_id: personId }));
    const pending = await loadPendingSubmission(admin, SCOUT, 'rank_req', TARGET_KEY);

    const first = await returnSubmission(admin, pending!.id, '[TEST] Leader', 'Once.');
    expect(first).toBeNull();

    const second = await returnSubmission(admin, pending!.id, '[TEST] Other', 'Twice.');
    expect(second).toMatch(/just reviewed by someone else/i);

    const { data } = await admin
      .from('requirement_submissions')
      .select('feedback_md')
      .eq('id', pending!.id)
      .single();
    expect(data!.feedback_md).toBe('Once.');
  });
});
