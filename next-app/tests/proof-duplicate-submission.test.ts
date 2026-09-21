import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { hasPendingSubmission, loadPendingSubmission } from '../src/lib/library-data';
import { proofSubmissionUnchanged } from '../src/lib/library';

/**
 * Duplicate "I did this" proof submissions (Patrick, 2026-09-20): the live
 * Proof Queue held Anjali ×3 on `first-class-9a` and Henry ×5 on
 * `first-class-7d`, inserted 0.6–1.0s apart — a double/triple-tap on a
 * submit button that stayed live while the action uploaded media and sent
 * an email. Three gaps let it through: no disable on the button, no
 * idempotency check before the insert, and a NON-unique
 * `requirement_submissions_target_idx`.
 *
 * The button disable is UI and the pre-insert check narrows the window, but
 * neither closes it — two tabs, a back-button resubmit, or a tap landing
 * before React hydrates all still race. The partial unique index is what
 * actually makes a second PENDING row impossible, and the predicate has to
 * be exactly `status = 'pending'` so that a scout whose proof was RETURNED
 * (or approved, then redone) can still submit again. Both halves are
 * asserted here — a migration that widens the predicate fails this file.
 *
 * Real local Postgres, no mocks (D-049). Fixture ids carry the `zz-dup`
 * prefix and are deleted in afterAll.
 */

const SCOUT = 'zz-dup-scout';
const OTHER_SCOUT = 'zz-dup-scout-other';
const TARGET_KEY = 'zz-dup-first-class-9a';
const OTHER_KEY = 'zz-dup-first-class-7d';

type Admin = ReturnType<typeof adminClient>;
let admin: Admin;

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
  await admin.from('requirement_submissions').delete().in('target_key', [TARGET_KEY, OTHER_KEY]);
};

beforeAll(async () => {
  admin = adminClient();
  await clean();
  await admin.from('scouts').delete().in('id', [SCOUT, OTHER_SCOUT]);
  for (const [id, name] of [
    [SCOUT, 'Dup One'],
    [OTHER_SCOUT, 'Dup Two']
  ]) {
    const { error } = await admin.from('scouts').insert({
      id,
      first_name: '[TEST]',
      last_name: name,
      display_name: `[TEST] ${name}`,
      active: true
    });
    if (error) throw new Error(`fixture scout ${id}: ${error.message}`);
  }
});

beforeEach(clean);

afterAll(async () => {
  await clean();
  await admin.from('scouts').delete().in('id', [SCOUT, OTHER_SCOUT]);
});

describe('pending proof submissions are unique per scout + requirement', () => {
  it('rejects a second pending row for the same scout and requirement', async () => {
    const { error: first } = await admin.from('requirement_submissions').insert(row());
    expect(first).toBeNull();

    const { error: second } = await admin.from('requirement_submissions').insert(row());
    expect(second?.code).toBe('23505');
  });

  it('allows a new pending row once the earlier one was returned', async () => {
    const { data } = await admin.from('requirement_submissions').insert(row()).select('id').single();
    await admin
      .from('requirement_submissions')
      .update({ status: 'returned', feedback_md: 'Add a photo.' })
      .eq('id', data!.id);

    const { error } = await admin.from('requirement_submissions').insert(row());
    expect(error).toBeNull();
  });

  it('allows a new pending row once the earlier one was approved', async () => {
    const { data } = await admin.from('requirement_submissions').insert(row()).select('id').single();
    await admin.from('requirement_submissions').update({ status: 'approved' }).eq('id', data!.id);

    const { error } = await admin.from('requirement_submissions').insert(row());
    expect(error).toBeNull();
  });

  it('does not constrain a different scout or a different requirement', async () => {
    const { error: mine } = await admin.from('requirement_submissions').insert(row());
    expect(mine).toBeNull();

    const { error: otherScout } = await admin
      .from('requirement_submissions')
      .insert(row({ scout_id: OTHER_SCOUT }));
    expect(otherScout).toBeNull();

    const { error: otherKey } = await admin
      .from('requirement_submissions')
      .insert(row({ target_key: OTHER_KEY }));
    expect(otherKey).toBeNull();
  });
});

describe('hasPendingSubmission', () => {
  it('is false when the scout has never submitted this requirement', async () => {
    expect(await hasPendingSubmission(admin, SCOUT, 'rank_req', TARGET_KEY)).toBe(false);
  });

  it('is true while a submission sits in the queue', async () => {
    await admin.from('requirement_submissions').insert(row());
    expect(await hasPendingSubmission(admin, SCOUT, 'rank_req', TARGET_KEY)).toBe(true);
  });

  it('is false again once the submission is approved', async () => {
    const { data } = await admin.from('requirement_submissions').insert(row()).select('id').single();
    await admin.from('requirement_submissions').update({ status: 'approved' }).eq('id', data!.id);
    expect(await hasPendingSubmission(admin, SCOUT, 'rank_req', TARGET_KEY)).toBe(false);
  });

  it('does not leak another scout’s pending work', async () => {
    await admin.from('requirement_submissions').insert(row({ scout_id: OTHER_SCOUT }));
    expect(await hasPendingSubmission(admin, SCOUT, 'rank_req', TARGET_KEY)).toBe(false);
  });

  it('hands back the claim itself so the action can compare against it', async () => {
    await admin
      .from('requirement_submissions')
      .insert(row({ body_md: 'First go.', proof_type: 'report' }));
    const found = await loadPendingSubmission(admin, SCOUT, 'rank_req', TARGET_KEY);
    expect(found).toMatchObject({ proof_type: 'report', body_md: 'First go.', link_url: null });
    expect(found?.id).toBeTypeOf('number');
  });
});

/**
 * The expensive direction is treating a REDO as a duplicate: only one
 * pending claim per requirement can exist, so a submission judged
 * "unchanged" is dropped and the scout is still shown "Sent". A scout who
 * rewrote a weak answer while a leader had not yet triaged the first one
 * would lose that work silently (qa-lead, 2026-09-20).
 */
describe('proofSubmissionUnchanged', () => {
  const pending = { proof_type: 'report', body_md: 'I talked to the alderman.', link_url: null };
  const same = {
    proofType: 'report',
    bodyMd: 'I talked to the alderman.',
    linkUrl: null,
    newMediaCount: 0
  };

  it('is true for the identical submission arriving twice', () => {
    expect(proofSubmissionUnchanged(pending, same)).toBe(true);
  });

  it('is false when the write-up was rewritten', () => {
    expect(
      proofSubmissionUnchanged(pending, { ...same, bodyMd: 'I talked to Alderman Bauman for an hour.' })
    ).toBe(false);
  });

  it('is false when a photo is attached this time, even if the caption matches', () => {
    expect(proofSubmissionUnchanged(pending, { ...same, newMediaCount: 1 })).toBe(false);
  });

  it('is false when the proof changed from a write-up to a link', () => {
    expect(
      proofSubmissionUnchanged(pending, {
        ...same,
        proofType: 'link',
        linkUrl: 'https://example.org/report'
      })
    ).toBe(false);
  });

  it('is false when the proof changed from a write-up to a photo caption', () => {
    expect(proofSubmissionUnchanged(pending, { ...same, proofType: 'photo', newMediaCount: 1 })).toBe(
      false
    );
  });

  it('treats a missing body on either side as the same empty value', () => {
    expect(
      proofSubmissionUnchanged(
        { proof_type: 'link', body_md: null, link_url: 'https://example.org/a' },
        { proofType: 'link', bodyMd: null, linkUrl: 'https://example.org/a', newMediaCount: 0 }
      )
    ).toBe(true);
  });
});
