import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  applyBlocks,
  blocksFromSignup,
  renderMessage,
  renderSummaryMd,
  type ConfirmationContext,
  type SignupBlocks
} from '../src/lib/signup-confirmation';
import { previewContext } from '../src/lib/signup-confirmation-preview';

/**
 * Patrick, 2026-08-25 (live test, only Attendance checked in the builder):
 * "For all templates, suppress content in the summary for blocks not
 * enabled." The echo-back only speaks to the blocks the signup actually
 * offered — no Rides caption on an event with no drivers, no "$0.00" on an
 * event with no prices.
 */
function ctx(household: Partial<ConfirmationContext['household']> = {}): ConfirmationContext {
  return {
    event: {
      title: 'Fall Campout',
      entryDate: '2026-10-09',
      endDate: '2026-10-11',
      startTime: null,
      endTime: null,
      location: null,
      deadline: null,
      publicUrl: 'https://www.troop-79.com/events/7',
      rosterUrl: 'https://www.troop-79.com/admin/calendar/7?tab=signup&view=roster',
      headcount: null
    },
    household: {
      label: 'The Bieser family',
      submitterName: 'Dana Bieser',
      submitterEmail: null,
      submitterPhone: null,
      people: [{ name: 'Avery', isAdult: false, status: 'yes' }],
      guests: ['+1 guest with Avery'],
      days: ['Avery: 2 days'],
      jobs: ['Grubmaster (Avery)'],
      rides: ['Dana driving out with 3 seats'],
      answers: ['Dietary needs: none'],
      notes: ['Allergic to bees'],
      slip: ['Permission slip required'],
      prices: ['Avery — Scout $45.00'],
      amountDue: 45,
      paid: 0,
      payment: 'Venmo @troop79',
      ...household
    },
    change: 'new',
    changes: null
  };
}

const ALL_ON: SignupBlocks = { guests: true, days: true, jobs: true, rides: true, prices: true, questions: true, notes: true };
const ATTENDANCE_ONLY: SignupBlocks = { guests: false, days: false, jobs: false, rides: false, prices: false, questions: false, notes: false };

describe('blocksFromSignup', () => {
  it('BlocksFromSignup_ReadsEachToggle_FromTheSignupRow', () => {
    const b = blocksFromSignup(
      { drivers_needed: true, guest_mode: 'count', notes_prompt: 'Anything else?' },
      { prices: [{ per: 'event' }], slots: [{}], questions: [{}] }
    );
    expect(b).toEqual({ guests: true, days: false, jobs: true, rides: true, prices: true, questions: true, notes: true });
  });

  it('BlocksFromSignup_IsAllOff_ForAttendanceOnly', () => {
    const b = blocksFromSignup({ drivers_needed: false, guest_mode: 'none', notes_prompt: null }, { prices: [], slots: [], questions: [] });
    expect(b).toEqual(ATTENDANCE_ONLY);
  });

  it('BlocksFromSignup_EnablesDays_OnlyWithAPerDayPrice', () => {
    const b = blocksFromSignup({}, { prices: [{ per: 'day' }], slots: [], questions: [] });
    expect(b.days).toBe(true);
    expect(b.prices).toBe(true);
  });
});

describe('applyBlocks', () => {
  it('ApplyBlocks_BlanksEveryDisabledSection_AndKeepsGoing', () => {
    const h = applyBlocks(ctx(), ATTENDANCE_ONLY).household;
    expect(h.people).toHaveLength(1);
    expect(h.guests).toEqual([]);
    expect(h.days).toEqual([]);
    expect(h.jobs).toEqual([]);
    expect(h.rides).toEqual([]);
    expect(h.answers).toEqual([]);
    expect(h.notes).toEqual([]);
    expect(h.prices).toEqual([]);
    expect(h.amountDue).toBe(0);
    expect(h.paid).toBe(0);
    expect(h.payment).toBeNull();
  });

  it('ApplyBlocks_LeavesEverything_WhenAllOn', () => {
    expect(applyBlocks(ctx(), ALL_ON)).toEqual(ctx());
  });
});

describe('summary with blocks off', () => {
  it('Summary_OmitsRidesAndAmountDue_ForAttendanceOnlySignup', () => {
    const md = renderSummaryMd(applyBlocks(ctx(), ATTENDANCE_ONLY), 'family');
    expect(md).toContain('**Going**');
    expect(md).not.toContain('Rides');
    expect(md).not.toContain('Amount due');
    expect(md).not.toContain('$0.00');
    expect(md).not.toContain('Prices');
  });

  it('DefaultFamilyTemplate_DropsTheAmountDueLine_WhenThereAreNoPrices', () => {
    const r = renderMessage(DEFAULT_TEMPLATES.family, applyBlocks(ctx(), ATTENDANCE_ONLY), 'family');
    expect(r.body).not.toContain('Amount due');
    expect(r.body).not.toContain('$0.00');
  });

  it('AmountDue_StillShowsZero_WhenPricesExistAndItIsPaid', () => {
    const md = renderSummaryMd(ctx({ amountDue: 0, paid: 45 }), 'family');
    expect(md).toContain('**Amount due:** $0.00 (paid $45.00)');
  });
});

describe('previewContext with blocks', () => {
  it('PreviewContext_HidesSampleRidesAndPrices_WhenThoseBlocksAreOff', () => {
    const c = previewContext({ entryId: 1, title: 'Hike', entryDate: '2026-10-09', siteUrl: '', blocks: ATTENDANCE_ONLY });
    expect(c.household.rides).toEqual([]);
    expect(c.household.prices).toEqual([]);
    expect(c.household.amountDue).toBe(0);
    expect(c.household.jobs).toEqual([]);
  });

  it('PreviewContext_KeepsTheSampleFacts_WithoutBlocks', () => {
    const c = previewContext({ entryId: 1, title: 'Hike', entryDate: '2026-10-09', siteUrl: '' });
    expect(c.household.rides.length).toBeGreaterThan(0);
    expect(c.household.amountDue).toBe(75);
  });
});
