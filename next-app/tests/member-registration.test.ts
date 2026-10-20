import { describe, it, expect } from 'vitest';
import { registrationLine, visibleRegistrations } from '../src/lib/member-registration';

/** The one line a family reads about each person's BSA registration. */
const TODAY = '2026-10-20';
const reg = (expires: string | null) => ({ expires });

describe('registrationLine', () => {
  it('Member_SeesRegisteredThrough_WhenFarOff', () => {
    expect(registrationLine(reg('2027-03-31'), TODAY)).toBe('Registered through Mar 31, 2027');
  });

  it('Member_SeesDueBy_WithinSixtyDays', () => {
    expect(registrationLine(reg('2026-12-19'), TODAY)).toBe('Renewal due by Dec 19, 2026');
  });

  it('Member_SeesExpired_WhenPast', () => {
    expect(registrationLine(reg('2026-08-31'), TODAY)).toBe('Expired Aug 31, 2026');
  });

  it('Member_SeesNotOnTheRoster_WithNoRegistration', () => {
    expect(registrationLine(reg(null), TODAY)).toBe('Not on the troop’s BSA roster');
  });
});

describe('visibleRegistrations', () => {
  const r = (personId: number, expires: string | null) => ({ personId, expires });

  it('Parent_DoesNotSeeThemselves_WhenNotRegistered', () => {
    expect(visibleRegistrations([r(1, null), r(2, '2027-01-31')], 1).map((x) => x.personId)).toEqual([2]);
  });

  it('Parent_SeesAnUnregisteredChild', () => {
    expect(visibleRegistrations([r(1, '2026-12-31'), r(2, null)], 1).map((x) => x.personId)).toEqual([1, 2]);
  });

  it('Member_StillSeesThemselves_WhenNobodyElseIsListed', () => {
    expect(visibleRegistrations([r(1, null)], 1).map((x) => x.personId)).toEqual([1]);
  });
});
