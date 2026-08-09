import { describe, it, expect } from 'vitest';
import { retargetNotice, retargetPlan } from '../src/lib/meeting-plan-publish';
import type { MeetingPlanPayload } from '../src/lib/meeting-plan-types';

/**
 * Meeting plan publish date (2026-08-08).
 *
 * publish() sent the payload alone, so the date baked in at generate time
 * decided where the plan landed — change the date field, hit Publish, and it
 * saved under the generated date while the screen showed the new one.
 *
 * The resolution is NOT to refuse the mismatch: a generated plan is a
 * suggestion and is meant to be reusable for another date. The selected date
 * wins, and the difference is stated out loud.
 */

const PLAN = { version: 1, meetingDate: '2026-08-09', title: 'Troop Meeting' } as MeetingPlanPayload;

describe('Meeting plan publish date', () => {
  it('SelectedDate_WinsOverTheGeneratedDate_WhenPublishing', () => {
    expect(retargetPlan(PLAN, '2026-08-16').meetingDate).toBe('2026-08-16');
  });

  it('Retarget_LeavesTheRestOfThePlanIntact', () => {
    // Re-aiming a suggestion changes where it lands, not what it says.
    const moved = retargetPlan(PLAN, '2026-08-16');
    expect(moved.title).toBe(PLAN.title);
    expect(moved.version).toBe(PLAN.version);
  });

  it('Retarget_IsANoOp_WhenTheDatesAlreadyAgree', () => {
    expect(retargetPlan(PLAN, '2026-08-09')).toBe(PLAN);
  });

  it('Retarget_IsANoOp_WhenNoDateWasSelected', () => {
    // An older client that doesn't send one: the payload's own date stands.
    expect(retargetPlan(PLAN, '')).toBe(PLAN);
  });

  it('Notice_StatesTheDifference_WhenPublishingToAnotherDate', () => {
    expect(retargetNotice('2026-08-09', '2026-08-16')).toBe(
      'These suggestions were generated for 2026-08-09 — publishing them for 2026-08-16.'
    );
  });

  it('Notice_IsSilent_WhenTheDatesAgree', () => {
    expect(retargetNotice('2026-08-16', '2026-08-16')).toBeNull();
  });
});
