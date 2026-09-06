import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { adminClient } from './helpers/admin-client';
import { GET } from '../src/app/(public)/signin/hint/route';
import { HINT_COOKIE, verifySignInHint } from '../src/lib/signin-hint';
import { IDENTITY_COOKIE, signIdentitySession } from '../src/lib/identity-session';

/**
 * The intake route itself — the security-critical glue between the Bugle
 * link and the hint cookie (qa-lead, 2026-09-06: the helpers were tested,
 * the handler that wires IP extraction, session bypass and the cookie write
 * was not). Calls the exported GET with a real NextRequest against local
 * Postgres; no Next server needed.
 */

const ORIGIN = 'http://localhost:3000';

function req(query: Record<string, string>, opts: { ip?: string; cookie?: string } = {}): NextRequest {
  const url = new URL('/signin/hint', ORIGIN);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers = new Headers();
  if (opts.ip) headers.set('x-forwarded-for', opts.ip);
  if (opts.cookie) headers.set('cookie', opts.cookie);
  return new NextRequest(url, { headers });
}

function hintCookieFrom(res: Response): string | null {
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = setCookie.match(new RegExp(`${HINT_COOKIE.name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

describe('/signin/hint — intake route', () => {
  let householdIds: number[] = [];
  let personIds: number[] = [];
  let eventIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (eventIds.length > 0) await admin.from('login_events').delete().in('id', eventIds);
    if (personIds.length > 0) await admin.from('household_members').delete().in('person_id', personIds);
    if (personIds.length > 0) await admin.from('people').delete().in('id', personIds);
    if (householdIds.length > 0) await admin.from('households').delete().in('id', householdIds);
    householdIds = [];
    personIds = [];
    eventIds = [];
  });

  async function makeAdult(email: string): Promise<number> {
    const admin = adminClient();
    const { data: hh, error: hhErr } = await admin.from('households').insert({ label: '[TEST] Route' }).select('id').single();
    if (hhErr || !hh) throw new Error(`fixture: household insert failed: ${hhErr?.message}`);
    householdIds.push(hh.id);
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: '[TEST] Route Adult', primary_email: email, active: true })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: person insert failed: ${error?.message}`);
    personIds.push(data.id);
    const { error: memErr } = await admin.from('household_members').insert({ household_id: hh.id, person_id: data.id });
    if (memErr) throw new Error(`fixture: household_members insert failed: ${memErr.message}`);
    return data.id as number;
  }

  it('HintIntake_RedirectsToCleanUrl_AndSetsCookie_ForAKnownAddress', async () => {
    const email = `vitest-hint-route-${Date.now()}@example.com`;
    const personId = await makeAdult(email);

    const res = await GET(req({ for: email, next: '/events/35/signup' }, { ip: '203.0.113.50' }));

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/events/35/signup`);
    const cookie = hintCookieFrom(res);
    expect(cookie).not.toBeNull();
    const hint = await verifySignInHint(cookie ?? undefined);
    expect(hint?.candidates.map((c) => c.personId)).toEqual([personId]);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(res.headers.get('set-cookie')).toMatch(/SameSite=lax/i);
  });

  it('HintIntake_SetsNoCookie_AndLogsAProbe_ForAnUnknownAddress', async () => {
    const admin = adminClient();
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const email = `vitest-hint-route-nobody-${Date.now()}@example.com`;

    const res = await GET(req({ for: email, next: '/events/35/signup' }, { ip }));

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/events/35/signup`);
    expect(hintCookieFrom(res)).toBeNull();
    const { data } = await admin.from('login_events').select('id, method, success, failure_reason').eq('ip', ip);
    const rows = (data ?? []) as { id: number; method: string; success: boolean; failure_reason: string | null }[];
    eventIds.push(...rows.map((r) => r.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'hint', success: false, failure_reason: 'hint-unknown' });
  });

  it('HintIntake_NeverRedirectsOffSite', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 50) + 201}`;
    const res = await GET(req({ for: 'x@example.com', next: 'https://evil.example/phish' }, { ip }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/signin`);
    const { data } = await adminClient().from('login_events').select('id').eq('ip', ip);
    eventIds.push(...((data ?? []) as { id: number }[]).map((r) => r.id));
  });

  it('HintIntake_IgnoresTheHint_ForAnEmptyOrUnmergedAddress', async () => {
    const res = await GET(req({ for: '{{EmailAddress}}', next: '/events/35/signup' }, { ip: '203.0.113.77' }));
    expect(res.status).toBe(303);
    expect(hintCookieFrom(res)).toBeNull();
    // An unmerged tag is not a probe — nothing is logged for it.
    const { data } = await adminClient().from('login_events').select('id').eq('ip', '203.0.113.77');
    expect(data ?? []).toHaveLength(0);
  });

  it('HintIntake_WavesASignedInAdultThrough_WithoutResolving', async () => {
    const email = `vitest-hint-route-adult-${Date.now()}@example.com`;
    await makeAdult(email);
    const session = await signIdentitySession({
      subjectKind: 'adult',
      personId: 1,
      householdKey: 'h1',
      displayName: 'Someone Else',
      epoch: 0,
      iat: Date.now()
    });

    const res = await GET(
      req({ for: email, next: '/events/35/signup' }, { cookie: `${IDENTITY_COOKIE.name}=${session}` })
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/events/35/signup`);
    expect(hintCookieFrom(res)).toBeNull();
  });

  it('HintIntake_StillResolves_ForAScoutSession', async () => {
    // The newsletter went to the parent; a scout's session on the shared
    // device must not hide the parent's one-tap sign-in.
    const email = `vitest-hint-route-scoutsess-${Date.now()}@example.com`;
    const personId = await makeAdult(email);
    const session = await signIdentitySession({
      subjectKind: 'scout',
      personId: 2,
      householdKey: 'h1',
      displayName: 'A Scout',
      epoch: 0,
      iat: Date.now()
    });

    const res = await GET(
      req({ for: email, next: '/events/35/signup' }, { cookie: `${IDENTITY_COOKIE.name}=${session}` })
    );

    const hint = await verifySignInHint(hintCookieFrom(res) ?? undefined);
    expect(hint?.candidates.map((c) => c.personId)).toEqual([personId]);
  });
});
