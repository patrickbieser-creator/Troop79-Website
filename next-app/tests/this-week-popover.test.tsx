import { describe, it, expect } from 'vitest';
import { placePanel } from '../src/app/(public)/planner/this-week-parts';

/** The planner's menus (Place…, the teacher pickers) float over the page, so a menu opened at the foot of a group, or
 *  inside the checklist's scroll box, is never cut off or opened out of view. */
const VIEW = { w: 1000, h: 800 };
const trigger = (top: number, left = 100, w = 80, h = 30) => ({ top, bottom: top + h, left, right: left + w });

describe('placePanel', () => {
  it('Panel_OpensBelowTheTrigger_WhenItFits', () => {
    expect(placePanel(trigger(100), { w: 300, h: 200 }, VIEW, false).top).toBe(138);
  });

  it('Panel_OpensAboveTheTrigger_WhenBelowIsShort', () => {
    expect(placePanel(trigger(700), { w: 300, h: 200 }, VIEW, false).top).toBe(492);
  });

  it('Panel_TallerThanEitherSide_StaysInTheWindowAndScrolls', () => {
    expect(placePanel(trigger(400), { w: 300, h: 900 }, VIEW, false)).toMatchObject({ top: 8, maxHeight: 784 });
  });

  it('Panel_RightAligned_EndsAtTheTriggersRightEdge', () => {
    expect(placePanel(trigger(100, 600), { w: 300, h: 200 }, VIEW, true).left).toBe(380);
  });

  it('Panel_NeverRunsOffTheRightEdge', () => {
    expect(placePanel(trigger(100, 900), { w: 300, h: 200 }, VIEW, false).left).toBe(692);
  });
});
