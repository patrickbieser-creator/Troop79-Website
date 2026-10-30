import { describe, it, expect } from 'vitest';
import { optionLine, planLoad, planRefusal, PLAN_MAX } from '../src/lib/family-week-shared';

/** The scout plan limit (Plans/Meeting-Planner-III-Family.md, D1, D3): the words lib/family-week refuses with. */
describe('the scout plan limit', () => {
  const on = (min: number) => ({ on: true, min });

  it('PlanLoad_CountsTickedItemsAndRequests', () => {
    expect(planLoad([on(10), { on: false, min: 30 }], [{ min: 15 }])).toEqual({ things: 2, minutes: 25 });
  });

  it('PlanRefusal_OverFourThings_SaysThePlanIsFull', () => {
    expect(planRefusal('Lily', planLoad([on(5), on(5), on(5), on(5)], []), 5)).toBe(`Lily’s plan is full: ${PLAN_MAX} things is the most for one meeting. Untick one to add something else.`);
  });

  it('PlanRefusal_OverSixtyMinutes_SaysWhatsLeft', () => {
    expect(planRefusal('Lily', planLoad([on(30)], []), 45)).toBe('That needs 45 min, and Lily’s plan has 30 left.');
  });

  it('PlanRefusal_FillingTheHourExactly_Fits', () => {
    expect(planRefusal('Lily', planLoad([on(15)], []), 45)).toBeNull();
  });

  it('OptionLine_LeadsWithCodeAndMinutes', () => {
    expect([optionLine({ code: 'Merit badge', sub: 'with a counselor', min: 45 }), optionLine({ sub: 'with the Tenderfoot group', min: 15 })]).toEqual([
      'Merit badge - 45 min · with a counselor',
      '15 min · with the Tenderfoot group'
    ]);
  });
});
