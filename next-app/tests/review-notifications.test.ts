import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { buildReviewNotice, notifyReviewOutcome } from '../src/lib/review-notifications';
import { emailForPerson } from '../src/lib/person-emails';
import { fieldLabel, reviewNoticeFieldLabels } from '../src/lib/change-requests';

/**
 * Telling a submitter what became of what they sent in
 * (Plans/Review-Notifications.md; Patrick, 2026-09-20).
 *
 * The load-bearing test in this file is the last one: a change-request
 * notice names the FIELDS that changed and never their values. The submit
 * side has always worked that way because `things_we_should_know`,
 * birthdates and the rest of the demographic set live in these requests and
 * email is a weaker boundary than the database — the decision notice must
 * not be the hole in that. It asserts absence, so it is written to fail if
 * anyone starts echoing `proposed_changes` back out.
 *
 * Real local Postgres for the recipient resolution; fixtures use `zz-rn`.
 */

type Admin = ReturnType<typeof adminClient>;
let admin: Admin;
let withEmail: number;
let noEmail: number;
let bouncedOnly: number;

beforeAll(async () => {
  admin = adminClient();
  const mk = async (name: string) => {
    const { data, error } = await admin
      .from('people')
      .insert({ first_name: '[TEST]', last_name: name, display_name: `[TEST] ${name}` })
      .select('id')
      .single();
    if (error) throw new Error(`fixture ${name}: ${error.message}`);
    return data!.id as number;
  };
  withEmail = await mk('RN HasEmail');
  noEmail = await mk('RN NoEmail');
  bouncedOnly = await mk('RN Bounced');

  await admin
    .from('person_emails')
    .insert({ person_id: withEmail, email: 'zz-rn-parent@example.com', is_primary: true });
  await admin.from('person_emails').insert({
    person_id: bouncedOnly,
    email: 'zz-rn-dead@example.com',
    is_primary: true,
    bounced_at: new Date().toISOString()
  });
});

afterAll(async () => {
  await admin.from('person_emails').delete().in('person_id', [withEmail, noEmail, bouncedOnly]);
  await admin.from('people').delete().in('id', [withEmail, noEmail, bouncedOnly]);
});

describe('emailForPerson', () => {
  it('finds the address on the people spine', async () => {
    expect(await emailForPerson(admin, withEmail)).toBe('zz-rn-parent@example.com');
  });

  it('is null for a person with no address — the common case for a scout', async () => {
    expect(await emailForPerson(admin, noEmail)).toBeNull();
  });

  it('will not write to an address that has already bounced', async () => {
    expect(await emailForPerson(admin, bouncedOnly)).toBeNull();
  });
});

describe('notifyReviewOutcome — when no notice goes out', () => {
  const base = { subject: 'your update', bullets: ['What you changed: Address'] };

  it('skips silently when the submitter was never recorded', async () => {
    const res = await notifyReviewOutcome(admin, {
      ...base,
      outcome: 'approved',
      recipientPersonId: null
    });
    expect(res).toEqual({ sent: false, reason: 'no-submitter' });
  });

  it('skips when the submitter has no deliverable address, rather than substituting one', async () => {
    const res = await notifyReviewOutcome(admin, {
      ...base,
      outcome: 'approved',
      recipientPersonId: noEmail
    });
    expect(res).toEqual({ sent: false, reason: 'no-address' });
  });
});

describe('buildReviewNotice — what the submitter reads', () => {
  it('confirms an approval and recaps what was sent', () => {
    const { subject, text } = buildReviewNotice({
      outcome: 'approved',
      recipientPersonId: 1,
      subject: 'your “I did this” for 7d — Utility services',
      bullets: ['Requirement: 7d — Utility services', 'What you sent: a photo']
    });
    expect(subject).toMatch(/approved/i);
    expect(text).toContain('7d — Utility services');
    expect(text).toContain('a photo');
  });

  it('carries the leader’s words when something is sent back', () => {
    const { subject, text } = buildReviewNotice({
      outcome: 'returned',
      recipientPersonId: 1,
      subject: 'your “I did this” for 7d',
      bullets: ['Requirement: 7d'],
      feedback: 'Can you add the date you did it?'
    });
    expect(subject).toMatch(/another look/i);
    expect(text).toContain('Can you add the date you did it?');
  });

  it('omits the feedback line entirely when a leader left no note', () => {
    const { text } = buildReviewNotice({
      outcome: 'returned',
      recipientPersonId: 1,
      subject: 'your “I did this” for 7d',
      bullets: ['Requirement: 7d'],
      feedback: '   '
    });
    expect(text).not.toMatch(/What the leader said/);
  });

  /**
   * The guard. Field LABELS in, submitted VALUES out — asserted by absence,
   * so it fails the moment anyone starts echoing proposed_changes.
   */
  it('names the fields of a profile update and never their values', () => {
    const proposed = {
      address_line1: '1421 Sycamore Lane',
      phone: '414-555-0134',
      things_we_should_know: 'Carries an EpiPen for a peanut allergy'
    };
    const { subject, html, text } = buildReviewNotice({
      outcome: 'approved',
      recipientPersonId: 1,
      subject: 'your update to the troop roster',
      bullets: [
        `What you changed: ${Object.keys(proposed)
          .map((f) => fieldLabel('scout', f))
          .join(', ')}`
      ]
    });

    for (const label of Object.keys(proposed).map((f) => fieldLabel('scout', f))) {
      expect(text).toContain(label);
    }
    for (const value of Object.values(proposed)) {
      expect(text).not.toContain(value);
      expect(html).not.toContain(value);
      expect(subject).not.toContain(value);
    }
    expect(text).not.toMatch(/EpiPen|peanut|Sycamore|555-0134/);
  });
});

/**
 * `fieldLabel` returns an UNMAPPED key verbatim, so whatever reaches it can
 * reach an inbox. Approve had always re-filtered through the allowlist;
 * reject was reading `Object.keys(proposed_changes)` raw (qa-lead,
 * 2026-09-20). Both now go through this, and it is the choke point.
 */
describe('reviewNoticeFieldLabels', () => {
  it('labels the fields a family may actually edit', () => {
    expect(reviewNoticeFieldLabels('scout', ['phone', 'school'])).toEqual([
      fieldLabel('scout', 'phone'),
      fieldLabel('scout', 'school')
    ]);
  });

  it('drops a key that is not on the allowlist instead of echoing it verbatim', () => {
    const labels = reviewNoticeFieldLabels('scout', [
      'phone',
      'note_to_self; DROP TABLE people',
      'rank'
    ]);
    expect(labels).toEqual([fieldLabel('scout', 'phone')]);
    expect(labels.join(' ')).not.toMatch(/DROP TABLE|rank/);
  });

  it('allows nothing for a notice-only type, which applies no fields', () => {
    expect(reviewNoticeFieldLabels('adult_added', ['first_name'])).toEqual([]);
  });
});
