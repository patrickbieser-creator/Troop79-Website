import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  proofSubmissionAllowedFor,
  proxyScoutIdFor,
  filedByLeaderLine,
  splitFiledByLine
} from '../src/lib/library';
import type { LibraryViewer } from '../src/lib/library-viewer';

/**
 * Proxy "I did this" (Patrick, 2026-09-07): a leader holding
 * `library.proxy_view` who is viewing a scout's page AS that scout's proxy
 * (`?viewScout=`) may file a proof claim on the scout's behalf. It still
 * lands in the review queue like any household submission — this is NOT a
 * Fast Entry sign-off — and the queue says who filed it.
 *
 * submit-proof/actions.ts needs a request (cookies) so, as with
 * tests/submit-proof-tier2.test.ts, this proves the pieces the action
 * composes: the widened gate, the proxy-match rule (the posted scout id is
 * never trusted on its own — it must equal the scout the resolver already
 * authorized as the proxied one), and the exact insert shape the action
 * writes against the real schema. `requirement_submissions.submitted_via`
 * is CHECK-constrained to ('family','scout') and there is no from-label
 * column, so the attribution rides as the first line of body_md and the
 * queue splits it back out — asserted below so a schema change that breaks
 * either half fails here first.
 *
 * Real local Postgres, no mocks (D-049). Fixture ids carry the `zz-proxy`
 * prefix and are deleted in afterAll.
 */

const SCOUT_A = 'zz-proxy-scout-a';
const SCOUT_B = 'zz-proxy-scout-b';
const TARGET_KEY = 'zz-proxy-mb-4a';

type Admin = ReturnType<typeof adminClient>;
let admin: Admin;
const submissionIds: number[] = [];

const PROXY_FOR_A: LibraryViewer = {
  kind: 'scout',
  scoutId: SCOUT_A,
  scoutName: '[TEST] Proxy A',
  switchOptions: [
    { id: SCOUT_A, name: '[TEST] Proxy A' },
    { id: SCOUT_B, name: '[TEST] Proxy B' }
  ],
  isProxy: true
};

const NO_SCOUT_CHOSEN: LibraryViewer = { kind: 'proxy-available', options: PROXY_FOR_A.switchOptions };

const OWN_HOUSEHOLD_A: LibraryViewer = { ...PROXY_FOR_A, isProxy: false };

beforeAll(async () => {
  admin = adminClient();
  await admin.from('requirement_submissions').delete().eq('target_key', TARGET_KEY);
  await admin.from('scouts').delete().in('id', [SCOUT_A, SCOUT_B]);
  for (const [id, name] of [
    [SCOUT_A, 'Proxy A'],
    [SCOUT_B, 'Proxy B']
  ]) {
    const { error } = await admin.from('scouts').insert({
      id,
      first_name: '[TEST]',
      last_name: name,
      display_name: `[TEST] ${name}`,
      active: true
    });
    if (error) throw new Error(`fixture: scout insert failed: ${error.message}`);
  }
});

afterAll(async () => {
  if (submissionIds.length > 0) {
    await admin.from('requirement_submissions').delete().in('id', submissionIds);
  }
  await admin.from('requirement_submissions').delete().eq('target_key', TARGET_KEY);
  await admin.from('scouts').delete().in('id', [SCOUT_A, SCOUT_B]);
});

describe('proxy proof submission', () => {
  it('Leader_WithProxyForScout_MaySubmitProof_ForThatScout', async () => {
    // The proxy match: the resolver said "proxy for A", the form posted A.
    const proxyScoutId = proxyScoutIdFor(PROXY_FOR_A, SCOUT_A);
    expect(proxyScoutId).toBe(SCOUT_A);
    expect(proofSubmissionAllowedFor('leader', { proxyScoutId, forScoutId: SCOUT_A })).toBe(true);
    // The identity-cookie leader is audience 'household' — the proxy branch
    // applies there too (the gate was already open; the branch decides WHOSE
    // claim it is).
    expect(proofSubmissionAllowedFor('household', { proxyScoutId, forScoutId: SCOUT_A })).toBe(true);

    // The insert exactly as the action writes it: submitted_via stays inside
    // the CHECK constraint, and the attribution is the first line of body_md.
    const filedBy = filedByLeaderLine('[TEST] Leader Vitest', '[TEST] Proxy A');
    const { data, error } = await admin
      .from('requirement_submissions')
      .insert({
        scout_id: proxyScoutId!,
        target_kind: 'mb_req',
        target_key: TARGET_KEY,
        proof_type: 'report',
        body_md: `${filedBy}\n\nRead the star chart at the campout.`,
        link_url: null,
        media: [],
        submitted_via: 'family',
        status: 'pending'
      })
      .select('id, scout_id, body_md, submitted_via, status')
      .single();
    expect(error).toBeNull();
    submissionIds.push(data!.id as number);
    expect(data!.scout_id).toBe(SCOUT_A);
    expect(data!.status).toBe('pending');

    // What the Proof Queue shows the reviewer.
    const split = splitFiledByLine(data!.body_md as string);
    expect(split.filedBy).toBe('[TEST] Leader Vitest (leader, on behalf of [TEST] Proxy A)');
    expect(split.body).toBe('Read the star chart at the campout.');
  });

  it('Leader_WithProxyForScout_IsRefused_ForAnotherScout', () => {
    // Proxy for A, but the form posted B — the posted id is never trusted.
    expect(proxyScoutIdFor(PROXY_FOR_A, SCOUT_B)).toBeNull();
    expect(
      proofSubmissionAllowedFor('leader', { proxyScoutId: SCOUT_A, forScoutId: SCOUT_B })
    ).toBe(false);
    expect(proofSubmissionAllowedFor('leader', { proxyScoutId: null, forScoutId: SCOUT_B })).toBe(false);
  });

  it('Leader_WithoutProxy_IsRefused', () => {
    // A leader who has not chosen a scout (or has no proxy grant at all).
    expect(proxyScoutIdFor(NO_SCOUT_CHOSEN, SCOUT_A)).toBeNull();
    expect(proxyScoutIdFor({ kind: 'none' }, SCOUT_A)).toBeNull();
    expect(proofSubmissionAllowedFor('leader', { proxyScoutId: null, forScoutId: SCOUT_A })).toBe(false);
    expect(proofSubmissionAllowedFor('leader')).toBe(false);
    // A verified parent viewing their OWN scout is not a proxy — that claim
    // takes the household path, not this one.
    expect(proxyScoutIdFor(OWN_HOUSEHOLD_A, SCOUT_A)).toBeNull();
  });

  it('SubmittedVia_Leader_IsRefusedBySchema_SoFamilyCarriesProxyClaims', async () => {
    // Documents WHY the action writes submitted_via 'family' for a
    // leader-filed claim: the column's CHECK constraint has no 'leader'.
    const { error } = await admin.from('requirement_submissions').insert({
      scout_id: SCOUT_A,
      target_kind: 'mb_req',
      target_key: TARGET_KEY,
      proof_type: 'report',
      body_md: 'should never land',
      media: [],
      submitted_via: 'leader',
      status: 'pending'
    });
    expect(error).not.toBeNull();
  });

  it('SplitFiledByLine_LeavesOrdinaryBodies_Untouched', () => {
    expect(splitFiledByLine('Just a write-up.')).toEqual({ filedBy: null, body: 'Just a write-up.' });
    expect(splitFiledByLine(null)).toEqual({ filedBy: null, body: null });
    // A leader-filed claim with a photo and no caption: attribution only.
    const only = filedByLeaderLine('L', 'S');
    expect(splitFiledByLine(only)).toEqual({ filedBy: 'L (leader, on behalf of S)', body: null });
  });
});
