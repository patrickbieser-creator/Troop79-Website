import { describe, it, expect, vi } from 'vitest';
import { dispatchConfirmations, type ConfirmationConfig, type DispatchDeps, type LogRow } from '../src/lib/signup-confirmation-send';
import type { ConfirmationContext } from '../src/lib/signup-confirmation';

vi.mock('../src/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));

/**
 * The dispatcher: audiences, recipients, one dedup, one log row per audience,
 * failures logged not thrown — with the transport and the log injected.
 */
const ctx: ConfirmationContext = {
  event: {
    title: 'Fall Campout', entryDate: '2026-10-09', endDate: null, startTime: null, endTime: null,
    location: 'Camp Long Lake', deadline: null, publicUrl: 'https://x/events/7', rosterUrl: 'https://x/admin/calendar/7?tab=signup&view=roster', headcount: '3 going'
  },
  household: {
    label: 'The Bieser family', submitterName: 'Dana', submitterEmail: 'dana@example.org', submitterPhone: '555',
    people: [{ name: 'Avery', isAdult: false, status: 'yes' }, { name: 'Dana', isAdult: true, status: 'yes' }],
    guests: [], days: [], jobs: [], rides: [], answers: [], notes: [], slip: [], prices: [], amountDue: 45, paid: 0, payment: 'Venmo @troop79'
  },
  change: 'new',
  changes: null
};
const members = [
  { email: 'avery@example.org', isAdult: false, signedUp: true },
  { email: 'dana@example.org', isAdult: true, signedUp: true }
];
const config = (over: Partial<ConfirmationConfig> = {}): ConfirmationConfig => ({
  familyEnabled: true,
  familyTemplate: null,
  familyOverride: { subject: null, body: null },
  leaderEnabled: true,
  leaderTemplate: null,
  leaderOverride: { subject: null, body: null },
  leaderUseFamily: false,
  leaderRecipients: ['lead@example.org', 'dana@example.org'],
  ...over
});

function deps(over: Partial<{ configured: boolean; send: ReturnType<typeof vi.fn> }> = {}) {
  const log: LogRow[] = [];
  const send = over.send ?? vi.fn(async (o: { to: string[] }) => ({ status: 'sent' as const, to: o.to }));
  const d = { configured: () => over.configured ?? true, send, log: async (r: LogRow) => { log.push(r); } } as unknown as DispatchDeps;
  return { d, send, log };
}

describe('dispatchConfirmations', () => {
  it('SendsBothAudiences_Individually_DedupedAcrossLists_WithReplyToTheFirstLeader', async () => {
    const { d, send, log } = deps();
    const r = await dispatchConfirmations({ signupId: 8, householdId: 3, config: config(), ctx, members, submitterEmail: 'dana@example.org' }, d);
    expect(r.error).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
    const [fam, lead] = send.mock.calls.map((c) => c[0]);
    expect(fam.to).toEqual(['dana@example.org', 'avery@example.org']);
    expect(lead.to).toEqual(['lead@example.org']); // dana is family first — never twice
    expect(fam.replyTo).toBe('lead@example.org');
    expect(fam.subject).toBe('Signed up: Fall Campout');
    expect(lead.subject).toBe('New signup: The Bieser family — Fall Campout');
    expect(lead.text).toContain('dana@example.org'); // leaders see contact details
    expect(fam.text).not.toContain('555'); // families never see the leader-only fields
    expect(fam.text).toContain('Amount due: $45.00'); // the summary rides along
    expect(log.map((l) => [l.audience, l.status, l.recipients.length])).toEqual([['family', 'sent', 2], ['leader', 'sent', 1]]);
  });

  it('UseTheFamilyMessage_SendsLeadersTheFamilyReceipt_WithLeaderTokensBlank', async () => {
    const { d, send } = deps();
    await dispatchConfirmations({ signupId: 8, householdId: 3, config: config({ leaderUseFamily: true }), ctx, members, submitterEmail: null }, d);
    const lead = send.mock.calls[1][0];
    expect(lead.subject).toBe('Signed up: Fall Campout');
    expect(lead.text).not.toContain('dana@example.org');
  });

  it('SkipsAnAudienceThatIsOff_AndEverythingWhenUnconfigured_Logged', async () => {
    const off = deps();
    await dispatchConfirmations({ signupId: 8, householdId: 3, config: config({ leaderEnabled: false }), ctx, members, submitterEmail: null }, off.d);
    expect(off.send).toHaveBeenCalledTimes(1);
    expect(off.log.map((l) => l.audience)).toEqual(['family']);
    const un = deps({ configured: false });
    const r = await dispatchConfirmations({ signupId: 8, householdId: 3, config: config(), ctx, members, submitterEmail: null }, un.d);
    expect(un.send).not.toHaveBeenCalled();
    expect(r.error).toBeNull();
    expect(un.log.map((l) => l.status)).toEqual(['skipped', 'skipped']);
  });

  it('AFailure_IsLoggedAndReturned_NeverThrown', async () => {
    const send = vi.fn(async () => {
      throw new Error('Resend down');
    });
    const { d, log } = deps({ send });
    const r = await dispatchConfirmations({ signupId: 8, householdId: 3, config: config({ leaderEnabled: false }), ctx, members, submitterEmail: null }, d);
    expect(r.error).toBe('family: Resend down');
    expect(log[0]).toMatchObject({ audience: 'family', status: 'failed', detail: 'Resend down' });
  });

  it('UpdateAndCancel_CarryTheChange_IntoSubjectAndLog', async () => {
    const { d, send, log } = deps();
    await dispatchConfirmations(
      { signupId: 8, householdId: 3, config: config({ leaderEnabled: false }), ctx: { ...ctx, change: 'cancel', changes: 'Your signup for Fall Campout was cancelled.' }, members, submitterEmail: null },
      d
    );
    expect(send.mock.calls[0][0].subject).toBe('Cancelled: Signed up: Fall Campout');
    expect(send.mock.calls[0][0].text).toContain('was cancelled');
    expect(log[0].change).toBe('cancel');
  });
});
