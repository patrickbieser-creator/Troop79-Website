import { describe, it, expect } from 'vitest';
import { planNewsletterSync, type SyncAddress, type ListContact } from '../src/lib/newsletter-sync';

/**
 * EmailOctopus sync plan (Patrick, 2026-10-20): every active person's every
 * address goes on the list; names follow People; an unsubscribe in
 * EmailOctopus comes back to person_emails and is never undone by a sync.
 */
function addr(personId: number, email: string, extra: Partial<SyncAddress> = {}): SyncAddress {
  return { personId, email, firstName: `First${personId}`, lastName: `Last${personId}`, isScout: false, ...extra };
}
function contact(email: string, status: ListContact['status'], first = '', last = ''): ListContact {
  return { id: `c-${email}`, email, status, firstName: first, lastName: last };
}

describe('planNewsletterSync', () => {
  it('Sync_AddsAnAddressNotOnTheList', () => {
    const plan = planNewsletterSync([addr(1, 'a@x.org')], [], []);
    expect(plan.add).toEqual([{ email: 'a@x.org', firstName: 'First1', lastName: 'Last1', personIds: [1] }]);
  });

  it('Sync_MatchesAddresses_IgnoringCaseAndSpaces', () => {
    const plan = planNewsletterSync([addr(1, ' A@X.org')], [contact('a@x.org', 'subscribed', 'First1', 'Last1')], []);
    expect([plan.add.length, plan.rename.length]).toEqual([0, 0]);
  });

  it('Sync_RenamesAContact_WhoseNameDiffersFromPeople', () => {
    const plan = planNewsletterSync([addr(1, 'a@x.org')], [contact('a@x.org', 'subscribed', 'Old', 'Name')], []);
    expect(plan.rename).toEqual([
      { contactId: 'c-a@x.org', email: 'a@x.org', firstName: 'First1', lastName: 'Last1', wasFirst: 'Old', wasLast: 'Name' }
    ]);
  });

  it('Sync_PullsBackAnUnsubscribe_AndNeverReAddsIt', () => {
    const plan = planNewsletterSync([addr(1, 'a@x.org')], [contact('a@x.org', 'unsubscribed')], []);
    expect([plan.markUnsubscribed, plan.add]).toEqual([['a@x.org'], []]);
  });

  it('Sync_NeverAdds_AnAddressAlreadyUnsubscribedHere', () => {
    const plan = planNewsletterSync([addr(1, 'a@x.org')], [], ['A@x.org']);
    expect(plan.add).toEqual([]);
  });

  it('Sync_LeavesAPendingContactAlone', () => {
    const plan = planNewsletterSync([addr(1, 'a@x.org')], [contact('a@x.org', 'pending', 'Old', 'Name')], []);
    expect([plan.add.length, plan.rename.length, plan.markUnsubscribed.length]).toEqual([0, 0, 0]);
  });

  it('Sync_NamesASharedAddress_AfterTheAdult', () => {
    const plan = planNewsletterSync([addr(5, 'fam@x.org', { isScout: true }), addr(9, 'fam@x.org')], [], []);
    expect(plan.add).toEqual([{ email: 'fam@x.org', firstName: 'First9', lastName: 'Last9', personIds: [5, 9] }]);
  });

  it('Sync_CountsContactsAlreadyInStep', () => {
    const plan = planNewsletterSync([addr(1, 'a@x.org')], [contact('a@x.org', 'subscribed', 'First1', 'Last1')], []);
    expect(plan.unchanged).toBe(1);
  });

  it('Sync_LeavesListContactsNotInPeople_Untouched', () => {
    const plan = planNewsletterSync([], [contact('stranger@x.org', 'subscribed')], []);
    expect(plan.onListOnly).toBe(1);
  });
});
