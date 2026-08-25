import { describe, it, expect } from 'vitest';
import { authorInitials, dateHover, dateLabel, statusPills, truncate } from '../src/lib/calendar-list';

/**
 * Admin calendar list row helpers (Patrick, 2026-08-24: the Roll Call list
 * folded into the Calendar; every event on one line; letter status pills).
 */
describe('authorInitials', () => {
  it('FirstInitialPlusLastName', () => {
    expect(authorInitials('Patrick Bieser')).toBe('PBieser');
    expect(authorInitials('Maya Sankpal-Tatera')).toBe('MSankpal-Tatera');
  });
  it('MiddleNames_AreDropped', () => {
    expect(authorInitials('John Q. Public')).toBe('JPublic');
  });
  it('SingleWord_PassesThrough_AndBlankIsADash', () => {
    expect(authorInitials('Operator')).toBe('Operator');
    expect(authorInitials(null)).toBe('—');
    expect(authorInitials('  ')).toBe('—');
  });
});

describe('truncate', () => {
  it('CutsAtMax_WithEllipsis', () => {
    expect(truncate('Northwoods, 1572 E Capitol Drive', 12)).toBe('Northwoods,…');
  });
  it('LeavesShortText_Alone', () => {
    expect(truncate('Northwoods', 12)).toBe('Northwoods');
    expect(truncate(null, 12)).toBe('');
  });
});

describe('dateLabel — one line, year dropped on a same-year span', () => {
  it('SingleDay_IsMmmDdYyyy', () => {
    expect(dateLabel('2026-08-30', null)).toBe('Aug 30, 2026');
    expect(dateLabel('2026-08-30', '2026-08-30')).toBe('Aug 30, 2026');
  });
  it('SameMonthSpan_DropsTheYear', () => {
    expect(dateLabel('2026-10-09', '2026-10-11')).toBe('Oct 9–11');
  });
  it('CrossMonthSpan_DropsTheYear', () => {
    expect(dateLabel('2026-07-30', '2026-08-02')).toBe('Jul 30 – Aug 2');
  });
  it('CrossYearSpan_KeepsBothYears', () => {
    expect(dateLabel('2025-12-30', '2026-01-02')).toBe('Dec 30, 2025 – Jan 2, 2026');
  });
});

describe('dateHover — weekday, time, note', () => {
  it('CarriesWeekdayTimeRangeAndNote', () => {
    expect(
      dateHover({ entry_date: '2026-08-30', start_time: '16:00:00', end_time: '17:30:00', day_note: 'Bring a headlamp' })
    ).toBe('Sunday, August 30, 2026 · 4:00 PM – 5:30 PM · Bring a headlamp');
  });
  it('WeekdayOnly_WhenNothingElseIsSet', () => {
    expect(dateHover({ entry_date: '2026-08-30' })).toBe('Sunday, August 30, 2026');
  });
});

describe('statusPills', () => {
  const base = { id: 7, on_calendar: true, agendaStatus: null, signupStatus: null, attendance: null };

  it('PlainOnCalendarEntry_HasOnlyAGreenO', () => {
    expect(statusPills(base)).toEqual([
      { letter: 'O', label: 'On the troop calendar', tone: 'live', href: null }
    ]);
  });

  it('OffCalendar_FlipsOToWhite', () => {
    expect(statusPills({ ...base, on_calendar: false })[0]).toMatchObject({ letter: 'O', tone: 'off' });
  });

  it('Agenda_PublishedIsGreen_DraftIsYellow_AndLinksToTheEditor', () => {
    expect(statusPills({ ...base, agendaId: 3, agendaStatus: 'published' })[0]).toMatchObject({
      letter: 'A', tone: 'live', href: '/admin/advancement/meetings/3'
    });
    expect(statusPills({ ...base, agendaId: 3, agendaStatus: 'draft' })[0]).toMatchObject({ letter: 'A', tone: 'draft' });
  });

  it('Signup_OpenIsGreen_ClosedIsGrey_AndLinksToTheBuilder', () => {
    expect(statusPills({ ...base, signupId: 9, signupStatus: 'open' })[0]).toMatchObject({
      letter: 'S', tone: 'live', href: '/admin/events/9'
    });
    expect(statusPills({ ...base, signupId: 9, signupStatus: 'closed' })[0]).toMatchObject({ letter: 'S', tone: 'closed' });
  });

  it('RollCall_AppearsOnlyOnceTaken_WithTheCountInTheHover', () => {
    expect(statusPills(base).some((p) => p.letter === 'R')).toBe(false);
    const r = statusPills({ ...base, attendance: { scouts: 12, adults: 3 } }).find((p) => p.letter === 'R')!;
    expect(r).toMatchObject({ tone: 'live', href: '/admin/calendar/7/roll-call' });
    expect(r.label).toContain('12 scouts + 3 adults');
  });

  it('Order_IsAgendaSignupRollCallOnCalendar', () => {
    const letters = statusPills({
      ...base, agendaId: 1, agendaStatus: 'draft', signupId: 2, signupStatus: 'open', attendance: { scouts: 1, adults: 0 }
    }).map((p) => p.letter);
    expect(letters).toEqual(['A', 'S', 'R', 'O']);
  });
});
