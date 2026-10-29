import { describe, it, expect } from 'vitest';
import { cleanDeclineNote, DECLINE_NOTE_CHARS } from '../src/lib/decline-note';

/** Emails E2: a teacher's "Not this week" note is cut to 3 lines and 240 characters before it is saved. */
describe('decline note', () => {
  it('Teacher_NotThisWeek_KeepsAtMostThreeLines', () => {
    expect(cleanDeclineNote('one\r\ntwo\nthree\nfour')).toBe('one\ntwo\nthree');
  });

  it('Teacher_NotThisWeek_KeepsAtMost240Characters', () => {
    expect(cleanDeclineNote('x'.repeat(300))?.length).toBe(DECLINE_NOTE_CHARS);
  });

  it('Teacher_NotThisWeek_BlankIsNoNote', () => {
    expect(cleanDeclineNote('   \n ')).toBeNull();
  });
});
