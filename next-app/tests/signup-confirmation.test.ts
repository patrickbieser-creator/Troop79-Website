import { describe, it, expect } from 'vitest';
import {
  describeChanges,
  fillTokens,
  mapUrl,
  renderMessage,
  resolveMessage,
  resolveRecipients,
  summaryLines,
  validateLeaderRecipients,
  type ConfirmationContext
} from '../src/lib/signup-confirmation';
import { TEMPLATE_KINDS, templateKind, LEADER_ONLY_FIELDS } from '../src/lib/email-templates';

/**
 * Signup confirmation — the pure half (Plans/Signup-Confirmation-Email.md,
 * Patrick 2026-08-25). Merge fields, recipients + dedup, the update diff, and
 * which copy wins — all without a database or a mail provider.
 */
function ctx(over: Partial<ConfirmationContext> = {}, household: Partial<ConfirmationContext['household']> = {}): ConfirmationContext {
  return {
    event: {
      title: 'Fall Campout',
      entryDate: '2026-10-09',
      endDate: '2026-10-11',
      startTime: '17:00:00',
      endTime: null,
      location: 'Camp Long Lake, St. Cloud WI',
      deadline: '2026-10-04',
      publicUrl: 'https://www.troop-79.com/events/7',
      rosterUrl: 'https://www.troop-79.com/admin/calendar/7?tab=signup&view=roster',
      headcount: '31 going of 40'
    },
    household: {
      label: 'The Bieser family',
      submitterName: 'Dana Bieser',
      submitterEmail: 'dana@example.org',
      submitterPhone: '414-555-0100',
      people: [
        { name: 'Avery', isAdult: false, status: 'yes' },
        { name: 'Blake', isAdult: false, status: 'yes' },
        { name: 'Dana Bieser', isAdult: true, status: 'yes' }
      ],
      guests: [],
      days: [],
      jobs: ['Friday setup'],
      rides: ['Dana driving out with 3 seats'],
      answers: ['Dietary needs: none'],
      notes: [],
      slip: ['Permission slip required'],
      prices: ['Avery — Scout $45', 'Blake — Scout $45', 'Dana — Adult $30'],
      amountDue: 120,
      paid: 0,
      payment: 'Venmo @troop79',
      ...household
    },
    change: 'new',
    changes: null,
    ...over
  };
}

describe('renderMessage — merge fields', () => {
  it('RenderMessage_ReplacesEveryKnownToken_ForEachAudience', () => {
    const family = templateKind('signup.family')!;
    const leader = templateKind('signup.leader')!;
    const body = [...leader.fields].map((f) => `${f.token}=[${f.token}]`).join('\n');
    const fam = renderMessage({ subject: '[event]', body }, ctx(), 'family');
    expect(fam.body).toContain('event=Fall Campout');
    expect(fam.body).toContain('date=Oct 9–11, 2026');
    expect(fam.body).toContain('time=5:00 PM');
    expect(fam.body).toContain('scouts=Avery and Blake');
    expect(fam.body).toContain('going=3 going (2 scouts, 1 adult)');
    expect(fam.body).toContain('amount_due=$120.00');
    expect(fam.body).toContain('payment=Venmo @troop79');
    expect(fam.body).toContain('deadline=Sun, Oct 4');
    expect(fam.body).toContain('changed=New signup');
    // Leader-only tokens are BLANK for a family template — never contact details.
    for (const f of LEADER_ONLY_FIELDS) expect(fam.body).toContain(`${f.token}=\n`.trimEnd());
    expect(fam.body).not.toContain('dana@example.org');
    expect(fam.body).not.toContain('414-555');
    const lead = renderMessage({ subject: '[event]', body }, ctx(), 'leader');
    expect(lead.body).toContain('household=The Bieser family');
    expect(lead.body).toContain('email=dana@example.org');
    expect(lead.body).toContain('roster_link=https://www.troop-79.com/admin/calendar/7?tab=signup&view=roster');
    expect(lead.body).toContain('headcount=31 going of 40');
    expect(family.fields.some((f) => f.token === 'household')).toBe(false);
  });

  it('MapToken_IsAGoogleMapsSearchUrl_FromTheLocation_AndBlankWithout', () => {
    expect(mapUrl('Camp Long Lake, St. Cloud WI')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Camp%20Long%20Lake%2C%20St.%20Cloud%20WI'
    );
    expect(mapUrl(null)).toBe('');
    const r = renderMessage({ subject: 's', body: 'At [location] ([map]).' }, ctx({}, {}), 'family');
    expect(r.body).toContain('(https://www.google.com/maps/search/?api=1&query=');
    const none = renderMessage({ subject: 's', body: 'At [location] ([map]).' }, { ...ctx(), event: { ...ctx().event, location: null } }, 'family');
    expect(none.body).toBe('At.'); // the empty parens and the stray space are tidied away
  });

  it('SummaryToken_OmitsBlankLines_AndIsFlagged_WhenTheTemplateLacksIt', () => {
    const lines = summaryLines(ctx());
    expect(lines[0]).toBe('Going: Avery, Blake, Dana Bieser');
    expect(lines).toContain('Jobs: Friday setup');
    expect(lines).toContain('Amount due: $120.00');
    expect(lines.some((l) => l.startsWith('Guests'))).toBe(false); // blank → omitted
    const withIt = renderMessage({ subject: 's', body: 'Hi.\n\n[summary]' }, ctx(), 'family');
    expect(withIt.hadSummary).toBe(true);
    expect(withIt.body).toContain('• Going: Avery, Blake, Dana Bieser');
    const without = renderMessage({ subject: 's', body: 'Hi.' }, ctx(), 'family');
    expect(without.hadSummary).toBe(false);
    expect(without.summaryLines.length).toBeGreaterThan(3);
  });

  it('RenderMessage_LeavesUnknownTokens_Alone', () => {
    expect(fillTokens('Hi [name], [foo] [bar_baz]', { name: 'Dana' })).toBe('Hi Dana, [foo] [bar_baz]');
  });

  it('DateToken_IsARangeForMultiDay_AndOneDayOtherwise', () => {
    const one = { ...ctx(), event: { ...ctx().event, endDate: null } };
    expect(renderMessage({ subject: '[date]', body: '' }, one, 'family').subject).toBe('October 9, 2026');
    expect(renderMessage({ subject: '[date]', body: '' }, ctx(), 'family').subject).toBe('Oct 9–11, 2026');
  });

  it('UpdateAndCancel_MarkTheSubjectAndBody_UnlessTheTemplateAlreadyDoes', () => {
    const upd = renderMessage(
      { subject: 'Signed up: [event]', body: 'Hi [name].' },
      ctx({ change: 'update', changes: 'Added Casey.' }),
      'family'
    );
    expect(upd.subject).toBe('Updated: Signed up: Fall Campout');
    expect(upd.body.startsWith('Added Casey.')).toBe(true);
    const own = renderMessage(
      { subject: '[changed]: [event]', body: '[changes]\nHi.' },
      ctx({ change: 'cancel', changes: 'Your signup for Fall Campout was cancelled.' }),
      'leader'
    );
    expect(own.subject).toBe('Cancelled signup: Fall Campout'); // no double prefix
    expect(own.body.split('\n')[0]).toBe('Your signup for Fall Campout was cancelled.');
  });
});

describe('recipients', () => {
  const members = [
    { email: 'avery@example.org', isAdult: false, signedUp: true },
    { email: null, isAdult: false, signedUp: true }, // Blake, no email — skipped, not an error
    { email: 'Dana@Example.org ', isAdult: true, signedUp: true },
    { email: 'sam@example.org', isAdult: true, signedUp: false } // parent who did not sign up
  ];

  it('FamilyRecipients_AreEverySignedUpMemberWithAnEmail_PlusTheSubmitter', () => {
    const r = resolveRecipients({ members, submitterEmail: 'dana@example.org', leaders: [] });
    expect(r.family).toEqual(['dana@example.org', 'avery@example.org']);
  });

  it('FamilyRecipients_CcEveryParent_WhenOnlyScoutsSignedUp', () => {
    const scoutsOnly = members.map((m) => (m.isAdult ? { ...m, signedUp: false } : m));
    const r = resolveRecipients({ members: scoutsOnly, submitterEmail: 'avery@example.org', leaders: [] });
    expect(r.family).toEqual(['avery@example.org', 'dana@example.org', 'sam@example.org']);
  });

  it('Recipients_AreDedupedAcrossBothLists_CaseAndWhitespaceInsensitive_FamilyWins', () => {
    const r = resolveRecipients({
      members: [
        { email: 'shared@example.org', isAdult: false, signedUp: true }, // scout on the family mailbox
        { email: 'SHARED@example.org', isAdult: true, signedUp: true }
      ],
      submitterEmail: 'shared@example.org',
      leaders: ['leader@example.org', 'Leader@example.org', 'shared@example.org', 'not-an-email']
    });
    expect(r.family).toEqual(['shared@example.org']);
    expect(r.leaders).toEqual(['leader@example.org']);
  });

  it('LeaderRecipients_AcceptUpToFive_RejectSixth_InvalidAndDuplicates', () => {
    const ok = validateLeaderRecipients(['a@x.org', ' B@x.org', '', 'c@x.org']);
    expect(ok).toEqual({ ok: true, recipients: ['a@x.org', 'b@x.org', 'c@x.org'], errors: [] });
    const bad = validateLeaderRecipients(['a@x.org', 'nope', 'a@x.org', 'd@x.org', 'e@x.org', 'f@x.org', 'g@x.org']);
    expect(bad.ok).toBe(false);
    expect(bad.errors).toEqual(['"nope" is not an email address.', 'a@x.org is listed twice.', 'Up to 5 addresses — you have 5.'.replace('5.', '5.')].filter((e) => !e.startsWith('Up to')));
    expect(bad.recipients).toHaveLength(5);
  });
});

describe('describeChanges — the update diff', () => {
  const row = (name: string, over: Partial<Parameters<typeof describeChanges>[0][number]> = {}) => ({
    name,
    status: 'yes',
    jobs: [],
    drivesOut: false,
    drivesBack: false,
    seatsOut: null,
    seatsBack: null,
    ...over
  });

  it('Describes_PeopleJobsAndRides_InPlainLanguage', () => {
    const before = [row('Avery'), row('Dana', { jobs: ['Friday setup'] })];
    const after = [row('Avery'), row('Blake'), row('Dana', { drivesOut: true, seatsOut: 3 })];
    expect(describeChanges(before, after)).toBe('Added Blake; dropped Friday setup; Dana now driving out with 3 seats.');
  });

  it('FallsBack_ToAGenericLine_WhenNothingSimpleChanged', () => {
    expect(describeChanges([row('Avery')], [row('Avery')])).toBe('Your signup was updated.');
  });

  it('Removed_Means_NoLongerGoing', () => {
    expect(describeChanges([row('Avery'), row('Blake')], [row('Avery'), row('Blake', { status: 'cancelled' })])).toBe(
      'Blake no longer going.'
    );
  });
});

describe('resolveMessage + registry', () => {
  it('ResolveMessage_UsesTheEventOverride_ElseTheTemplate_ElseTheSeededDefault', () => {
    const t = { subject: 'T', body: 'tb' };
    expect(resolveMessage('family', { subject: 'O', body: 'ob' }, t)).toEqual({ subject: 'O', body: 'ob' });
    expect(resolveMessage('family', { subject: 'O', body: null }, t)).toEqual(t); // half an override is no override
    expect(resolveMessage('leader', { subject: null, body: null }, null).subject).toBe('[changed]: [household] — [event]');
  });

  it('TemplateKinds_AreARegistry_NotAnEnum', () => {
    expect(TEMPLATE_KINDS.map((k) => k.kind)).toEqual(['signup.family', 'signup.leader']);
    expect(templateKind('newsletter')).toBeUndefined(); // added by registering, not migrating
  });
});
