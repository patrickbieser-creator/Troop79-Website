/**
 * EmailOctopus sync — what one run would change (Patrick, 2026-10-20).
 *
 * Every address of every active person goes on the troop's list. Names follow
 * People. An unsubscribe in EmailOctopus is the subscriber's choice: it comes
 * back to person_emails.unsubscribed_at and no sync ever adds that address
 * again. Contacts on the list that aren't in People are left alone, and so is
 * a pending (double opt-in) contact.
 *
 * Pure: the admin action loads both sides and applies the plan.
 */

export interface SyncAddress {
  personId: number;
  email: string;
  firstName: string;
  lastName: string;
  isScout: boolean;
}

export interface ListContact {
  id: string;
  email: string;
  status: 'subscribed' | 'unsubscribed' | 'pending';
  firstName: string;
  lastName: string;
}

export interface PlannedAdd {
  email: string;
  firstName: string;
  lastName: string;
  /** Everyone in People with this address (a shared family address names its adult). */
  personIds: number[];
}

export interface PlannedRename {
  contactId: string;
  email: string;
  firstName: string;
  lastName: string;
  wasFirst: string;
  wasLast: string;
}

export interface SyncPlan {
  add: PlannedAdd[];
  rename: PlannedRename[];
  /** Unsubscribed in EmailOctopus but not yet in person_emails. */
  markUnsubscribed: string[];
  unchanged: number;
  /** On the list, but no active person has the address. */
  onListOnly: number;
}

export const normEmail = (e: string) => e.trim().toLowerCase();

export function planNewsletterSync(addresses: SyncAddress[], contacts: ListContact[], unsubscribedHere: string[]): SyncPlan {
  const suppressed = new Set(unsubscribedHere.map(normEmail));
  const byEmail = new Map<string, SyncAddress[]>();
  for (const a of addresses) {
    const key = normEmail(a.email);
    if (!key) continue;
    byEmail.set(key, [...(byEmail.get(key) ?? []), a]);
  }
  const contactOf = new Map(contacts.map((c) => [normEmail(c.email), c]));

  const plan: SyncPlan = { add: [], rename: [], markUnsubscribed: [], unchanged: 0, onListOnly: 0 };
  for (const [email, owners] of byEmail) {
    // A shared address is named after the adult who has it; otherwise the first person.
    const named = owners.find((o) => !o.isScout) ?? owners[0];
    const c = contactOf.get(email);
    if (!c) {
      if (!suppressed.has(email)) {
        plan.add.push({ email, firstName: named.firstName, lastName: named.lastName, personIds: owners.map((o) => o.personId) });
      }
      continue;
    }
    if (c.status === 'unsubscribed') {
      if (!suppressed.has(email)) plan.markUnsubscribed.push(email);
      continue;
    }
    if (c.status === 'pending') continue;
    if (c.firstName.trim() !== named.firstName.trim() || c.lastName.trim() !== named.lastName.trim()) {
      plan.rename.push({ contactId: c.id, email, firstName: named.firstName, lastName: named.lastName, wasFirst: c.firstName, wasLast: c.lastName });
    } else {
      plan.unchanged++;
    }
  }
  plan.onListOnly = contacts.filter((c) => !byEmail.has(normEmail(c.email))).length;
  return plan;
}
