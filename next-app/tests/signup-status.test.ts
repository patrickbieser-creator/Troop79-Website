import { describe, it, expect } from 'vitest';
import { signedUpNames, type SignupContext } from '../src/app/(public)/events/[id]/signup-context';

/**
 * The event page's "you're already signed up" line (step 4 of
 * Plans/Calendar-Detail-And-Signup-Split.md).
 *
 * The form used to answer this simply by being on the page with the family's
 * entries in it. Moving the form to its own route took that answer away, and
 * the predictable consequence of a family not knowing they already responded
 * is a second submission — so this line is load-bearing, not decoration.
 *
 * Pure over the loaded context, so it tests without a database or a renderer.
 */

function ctx(over: {
  household?: SignupContext['household'];
  existing?: Partial<SignupContext['existing'][number]>[];
}): SignupContext {
  return {
    household: over.household ?? null,
    existing: (over.existing ?? []) as SignupContext['existing']
  } as SignupContext;
}

const HOUSEHOLD = {
  key: '1',
  label: 'Sankpal-Tatera',
  scouts: [{ id: 'A02', displayName: 'Anjali Sankpal-Tatera', personId: 11 }],
  adults: [
    { key: 'pe82', personId: 82, leaderCode: null, name: 'Patrick Bieser', relationship: 'Dad', email: null },
    { key: 'pe83', personId: 83, leaderCode: null, name: 'Jamie Lynn Tatera', relationship: 'Mom', email: null }
  ]
} as SignupContext['household'];

describe('signedUpNames', () => {
  it('Status_IsEmpty_WhenNoHouseholdIsResolved', () => {
    // An anonymous visitor has no household, so there is nothing to report —
    // and reporting anything here would leak who is attending.
    expect(signedUpNames(ctx({ existing: [{ person_id: 82, status: 'yes' }] }))).toEqual([]);
  });

  it('Status_IsEmpty_WhenTheHouseholdHasNotResponded', () => {
    expect(signedUpNames(ctx({ household: HOUSEHOLD, existing: [] }))).toEqual([]);
  });

  it('Status_NamesEveryoneAttending_AcrossScoutsAndAdults', () => {
    const names = signedUpNames(
      ctx({
        household: HOUSEHOLD,
        existing: [
          { person_id: 11, status: 'yes' },
          { person_id: 82, status: 'yes' }
        ]
      })
    );
    expect(names).toEqual(['Anjali Sankpal-Tatera', 'Patrick Bieser']);
  });

  it('Status_CountsAWaitlistedPerson_SinceTheyDidRespond', () => {
    // Waitlisted is still a response — telling them they aren't signed up
    // would invite exactly the duplicate submission this line exists to stop.
    expect(
      signedUpNames(ctx({ household: HOUSEHOLD, existing: [{ person_id: 83, status: 'waitlist' }] }))
    ).toEqual(['Jamie Lynn Tatera']);
  });

  it('Status_OmitsSomeoneMarkedNotAttending', () => {
    // "Can't make it" is a recorded answer, not a signup — saying "you're
    // signed up: Patrick" to someone who declined would be wrong.
    expect(
      signedUpNames(ctx({ household: HOUSEHOLD, existing: [{ person_id: 82, status: 'no' }] }))
    ).toEqual([]);
  });

  it('Status_IgnoresAPersonWhoIsNoLongerInTheHousehold', () => {
    // An entry whose person has since moved households would otherwise render
    // as `undefined` in the middle of the sentence.
    expect(
      signedUpNames(ctx({ household: HOUSEHOLD, existing: [{ person_id: 999, status: 'yes' }] }))
    ).toEqual([]);
  });
});
