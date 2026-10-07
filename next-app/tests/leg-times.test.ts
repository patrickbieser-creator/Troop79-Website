import { describe, it, expect } from 'vitest';
import { checkLegTimes, LEG_TIME_WINDOW_DAYS } from '../src/lib/leg-times';

/**
 * qa-lead on v1.191.0 (Plans/Event-Signup-Arrival-Times.md): the family submit
 * used to hand out_departs_at / back_departs_at straight from client JSON to
 * the RPC's ::timestamptz cast — a bad value was a raw cast error, and a
 * far-off instant stamped a car with a wave nobody meant. Now a pure check
 * runs before the RPC: each leg time must parse and fall inside the event's
 * days ± LEG_TIME_WINDOW_DAYS, and when the signup has no transportation
 * (drivers_needed false) the times are dropped — there is no car set to
 * stamp, and the form never shows the fields.
 */
const event = { entryDate: '2026-10-16', endDate: '2026-10-18', driversNeeded: true };

function entry(over: Record<string, unknown>): Record<string, unknown> {
  return { person_id: 1, status: 'yes', ...over };
}

describe('checkLegTimes', () => {
  it('Family_CanLeaveLegTimesEmpty_WithTheGroup', () => {
    const r = checkLegTimes([entry({ out_departs_at: null, back_departs_at: '' }), entry({})], event);
    expect(r.ok).toBe(true);
  });

  it('Family_CanArriveLater_OnAnEventDay', () => {
    const r = checkLegTimes([entry({ out_departs_at: '2026-10-17T01:00:00.000Z' })], event);
    expect(r.ok).toBe(true);
  });

  it('Family_CanArriveTheDayBefore_InsideTheWindow', () => {
    const r = checkLegTimes([entry({ out_departs_at: '2026-10-15T20:00:00.000Z' })], event);
    expect(r.ok).toBe(true);
  });

  it('Family_IsRefused_WhenALegTimeIsNotADate', () => {
    const r = checkLegTimes([entry({ out_departs_at: 'next tuesday' })], event);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/times? is not valid/i) });
  });

  it('Family_IsRefused_WhenALegTimeIsNotAString', () => {
    const r = checkLegTimes([entry({ back_departs_at: 12345 })], event);
    expect(r.ok).toBe(false);
  });

  it('Family_IsRefused_WhenALegTimeIsFarFromTheEvent', () => {
    const r = checkLegTimes([entry({ back_departs_at: '2027-03-01T12:00:00.000Z' })], event);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/within .* of the event/i) });
  });

  it('Window_IsSymmetricAroundTheEventsDays', () => {
    const dayMs = 86_400_000;
    const before = new Date(Date.UTC(2026, 9, 16) - LEG_TIME_WINDOW_DAYS * dayMs - 60_000).toISOString();
    const after = new Date(Date.UTC(2026, 9, 19) + LEG_TIME_WINDOW_DAYS * dayMs + 60_000).toISOString();
    expect(checkLegTimes([entry({ out_departs_at: before })], event).ok).toBe(false);
    expect(checkLegTimes([entry({ back_departs_at: after })], event).ok).toBe(false);
  });

  it('OneDayEvent_UsesItsOnlyDay_AsBothEnds', () => {
    const oneDay = { ...event, endDate: null };
    expect(checkLegTimes([entry({ back_departs_at: '2026-10-18T12:00:00.000Z' })], oneDay).ok).toBe(true);
    expect(checkLegTimes([entry({ back_departs_at: '2026-10-25T12:00:00.000Z' })], oneDay).ok).toBe(false);
  });

  it('LegTimes_AreDropped_WhenTheSignupHasNoTransportation', () => {
    const r = checkLegTimes(
      [entry({ out_departs_at: '2026-10-17T01:00:00.000Z', back_departs_at: 'garbage' })],
      { ...event, driversNeeded: false }
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entries[0]).toMatchObject({ out_departs_at: null, back_departs_at: null });
  });

  it('Entries_ThatAreNotObjects_PassThroughToTheRpcsOwnChecks', () => {
    const r = checkLegTimes(['nonsense', null], event);
    expect(r.ok).toBe(true);
  });
});

describe('submitSignupAction wiring', () => {
  it('SubmitSignupAction_ChecksLegTimes_BeforeTheRpc', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/app/(public)/events/[id]/actions.ts', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export async function submitSignupAction'));
    const check = fn.indexOf('checkLegTimes(');
    const rpc = fn.indexOf("rpc('submit_household_signup'");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(rpc);
  });

  it('SubmitSignupAction_ChecksLegTimes_BeforeAnyWrite', async () => {
    // qa-lead (v1.198.2 review): a refused leg time must not leave new adults
    // already added to the household — a resubmit would add them twice.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/app/(public)/events/[id]/actions.ts', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export async function submitSignupAction'));
    expect(fn.indexOf('checkLegTimes(')).toBeLessThan(fn.indexOf("rpc('add_parent_to_household'"));
  });
});
