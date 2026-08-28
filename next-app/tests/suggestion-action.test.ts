import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The server action behind "Make a Suggestion" (qa-lead, 2026-08-28: the
 * pure half was tested, the security-relevant glue was not). Everything
 * around it is mocked — this proves the gate, that identity comes from the
 * session and not the caller, and how each send outcome is reported.
 */

const { requireCapability, resolveAdminActor, sendEmail, maybeSingle } = vi.hoisted(() => ({
  requireCapability: vi.fn<(c: string) => Promise<void>>(async () => undefined),
  resolveAdminActor: vi.fn(async () => ({ label: 'Becky Vest', personId: 86 })),
  sendEmail: vi.fn<(o: unknown) => Promise<{ status: string; to: string[]; detail?: string }>>(async () => ({ status: 'sent', to: [] })),
  maybeSingle: vi.fn(async () => ({ data: { primary_email: 'becky@example.com' } }))
}));

vi.mock('@/lib/require-capability', () => ({ requireCapability }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor }));
vi.mock('@/lib/email', async (orig) => ({ ...(await orig<object>()), sendEmail }));
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })
  })
}));

import { sendSuggestionAction } from '../src/app/admin/(workspace)/advancement/dashboard/suggestion-actions';

beforeEach(() => {
  vi.clearAllMocks();
  // A dev .env.local may point the troop inbox at the developer; pin both.
  process.env.TROOP_NOTIFICATION_EMAIL = 'troop@example.com';
  process.env.SUGGESTION_OWNER_EMAIL = 'owner@example.com';
  sendEmail.mockResolvedValue({ status: 'sent', to: [] });
});

describe('sendSuggestionAction', () => {
  it('Action_RequiresAdvancementWrite_BeforeAnythingElse', async () => {
    requireCapability.mockRejectedValueOnce(new Error('redirect'));
    await expect(sendSuggestionAction('hi')).rejects.toThrow('redirect');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('Action_UsesSessionIdentity_WhenSending', async () => {
    const res = await sendSuggestionAction('Remember my tab.');
    expect(res).toEqual({ ok: true });
    expect(requireCapability).toHaveBeenCalledWith('advancement.write');
    const call = sendEmail.mock.calls[0][0] as { to: string[]; subject: string; replyTo?: string; confirm: boolean };
    expect(call.to).toEqual(['troop@example.com', 'owner@example.com']);
    expect(call.subject).toBe('Website suggestion from Becky Vest');
    expect(call.replyTo).toBe('becky@example.com');
    expect(call.confirm).toBe(true);
  });

  it('Action_RejectsBlank_WithoutSending', async () => {
    const res = await sendSuggestionAction('   ');
    expect(res.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('Action_ReportsError_WhenSendFails', async () => {
    sendEmail.mockResolvedValueOnce({ status: 'error', to: [], detail: 'boom' });
    expect(await sendSuggestionAction('hi')).toEqual({ ok: false, error: 'boom' });
  });

  it('Action_ReportsNotConfigured_WhenSendSkipped', async () => {
    sendEmail.mockResolvedValueOnce({ status: 'skipped', to: [], detail: 'Email is not configured on this server (RESEND_API_KEY / EMAIL_FROM unset).' });
    const res = await sendSuggestionAction('hi');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not configured/);
  });

  it('Action_ReportsPartialFailure_WhenOneInboxFails', async () => {
    sendEmail.mockResolvedValueOnce({ status: 'sent', to: [], detail: '1 sent, 1 failed: x: nope' });
    const res = await sendSuggestionAction('hi');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/^Partly sent/);
  });
});
