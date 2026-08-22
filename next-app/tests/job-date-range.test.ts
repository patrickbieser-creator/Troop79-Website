import { describe, it, expect } from 'vitest';
import { jobDateNote } from '../src/lib/event-signup-shared';

/**
 * Flagging a job dated outside its event (Patrick + the troop's event
 * coordinator, 2026-08-22).
 *
 * WHY: the builder happily holds a job two weeks away from its event and says
 * nothing. That cost three rounds of confusion on one event — a stray Sep 2
 * job on a Sep 16 service project read as "the clone didn't shift the dates",
 * then made two otherwise-identical rows impossible to tell apart when
 * deleting one. The date was the only thing that differed, in a dense column.
 *
 * A job legitimately falls outside the event — the Thursday shopping run
 * before a Friday campout is the canonical case — so this NOTES, never
 * blocks. It just refuses to let the difference be invisible.
 */

describe('job date range — noting a job outside its event (pure)', () => {
  it('JobDateNote_IsSilent_WhenTheJobIsOnTheEventDate', () => {
    expect(jobDateNote('2026-09-16', '2026-09-16', null)).toBeNull();
  });

  it('JobDateNote_IsSilent_ForAnUntimedTaskWithNoDate', () => {
    // "Anytime before the event" is a real, valid state — not a mistake.
    expect(jobDateNote(null, '2026-09-16', null)).toBeNull();
  });

  it('JobDateNote_IsSilent_AnywhereInsideAMultiDayEvent', () => {
    // A Saturday shift on a Fri–Sun campout is exactly where it belongs.
    expect(jobDateNote('2026-10-10', '2026-10-09', '2026-10-11')).toBeNull();
    expect(jobDateNote('2026-10-09', '2026-10-09', '2026-10-11')).toBeNull();
    expect(jobDateNote('2026-10-11', '2026-10-09', '2026-10-11')).toBeNull();
  });

  it('JobDateNote_CountsDaysBefore_WhenTheJobLandsEarly', () => {
    // The Thursday shopping run before a Friday campout — valid, and worth
    // stating so nobody has to work it out from two ISO dates.
    const note = jobDateNote('2026-10-08', '2026-10-09', '2026-10-11');
    expect(note).toEqual({ direction: 'before', days: 1, text: '1 day before the event' });
  });

  it('JobDateNote_CountsDaysAfter_WhenTheJobLandsLate', () => {
    const note = jobDateNote('2026-10-13', '2026-10-09', '2026-10-11');
    expect(note).toEqual({ direction: 'after', days: 2, text: '2 days after the event' });
  });

  it('JobDateNote_MeasuresFromTheNearestEdge_NotTheStart', () => {
    // On a Fri–Sun event, a Monday job is 1 day after the END, not 3 after the
    // start — the bigger number would read as a worse mistake than it is.
    expect(jobDateNote('2026-10-12', '2026-10-09', '2026-10-11')?.days).toBe(1);
  });

  it('JobDateNote_PluralizesDays', () => {
    expect(jobDateNote('2026-09-02', '2026-09-16', null)?.text).toBe('14 days before the event');
    expect(jobDateNote('2026-09-15', '2026-09-16', null)?.text).toBe('1 day before the event');
  });

  it('JobDateNote_IsSilent_WhenTheEventHasNoDate', () => {
    // Nothing to compare against; a note would be noise.
    expect(jobDateNote('2026-09-02', '', null)).toBeNull();
  });
});
