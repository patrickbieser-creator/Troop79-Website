import { describe, it, expect } from 'vitest';
import { eventForLabel } from '../src/lib/finance';

/** The ledger's Record / Edit / bulk Activity link a row to the calendar event
 *  its label names (Patrick, 2026-10-17) — only when exactly one event owns it. */
describe('eventForLabel (pure)', () => {
  it('EventForLabel_IsTheEvent_WhenLinkedRowsAndTitleAgree', () => {
    expect(eventForLabel([35, 35], [35])).toBe(35);
  });
  it('EventForLabel_IsTheEvent_WhenOnlyATitleMatches', () => {
    expect(eventForLabel([], [22])).toBe(22);
  });
  it('EventForLabel_IsNull_WhenTwoEventsShareTheLabel', () => {
    expect(eventForLabel([22], [23])).toBeNull();
  });
  it('EventForLabel_IsNull_WhenNoEventOwnsTheLabel', () => {
    expect(eventForLabel([], [])).toBeNull();
  });
});
