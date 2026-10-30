import { describe, it, expect, afterEach, vi } from 'vitest';
import { Webhook } from 'standardwebhooks';
import { config as proxyConfig } from '../src/proxy';

/**
 * The Resend webhook route: a valid Standard Webhooks signature over the raw body or nothing, fail CLOSED with no
 * secret (the Stripe route's rule), Resend's svix-* header names accepted, and the admin-only proxy never in front.
 */
const SECRET = `whsec_${Buffer.from('vitest-resend-webhook-secret-32b').toString('base64')}`;
const OTHER = `whsec_${Buffer.from('someone-else-entirely-secret-32b').toString('base64')}`;
// An event the route ignores, so these tests never touch the email log.
const body = JSON.stringify({ type: 'email.sent', created_at: '2026-10-30T12:00:00.000Z', data: { email_id: 're_vitest_route' } });

function signed(secret: string, prefix: 'svix' | 'webhook' = 'svix'): Record<string, string> {
  const id = 'msg_vitest_route';
  const at = new Date();
  return {
    [`${prefix}-id`]: id,
    [`${prefix}-timestamp`]: String(Math.floor(at.getTime() / 1000)),
    [`${prefix}-signature`]: new Webhook(secret).sign(id, at, body)
  };
}

async function post(headers: Record<string, string> = {}) {
  const { POST } = await import('../src/app/api/resend/webhook/route');
  return POST(new Request('https://troop.test/api/resend/webhook', { method: 'POST', body, headers }));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/resend/webhook', () => {
  it('ResendWebhook_FailsClosed_WhenTheSecretIsNotConfigured', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', '');
    expect((await post(signed(SECRET))).status).toBe(503);
  });

  it('ResendWebhook_FailsClosedAsConfig_WhenTheSecretIsMalformed', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', 'not-a-whsec-secret');
    expect((await post(signed(SECRET))).status).toBe(503);
  });

  it('ResendWebhook_RejectsATamperedBody', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET);
    const { POST } = await import('../src/app/api/resend/webhook/route');
    const res = await POST(new Request('https://troop.test/api/resend/webhook', { method: 'POST', body: body.replace('email.sent', 'email.opened'), headers: signed(SECRET) }));
    expect(res.status).toBe(400);
  });

  it('ResendWebhook_RejectsAMissingSignature', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET);
    expect((await post()).status).toBe(400);
  });

  it('ResendWebhook_RejectsASignatureFromAnotherSecret', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET);
    expect((await post(signed(OTHER))).status).toBe(400);
  });

  it('ResendWebhook_AcceptsAValidlySignedEvent_WithSvixHeaders', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET);
    expect((await post(signed(SECRET))).status).toBe(200);
  });

  it('ResendWebhook_AcceptsAValidlySignedEvent_WithWebhookHeaders', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', `${SECRET}\n`);
    expect((await post(signed(SECRET, 'webhook'))).status).toBe(200);
  });

  it('ResendWebhook_ProxyDoesNotGate_ApiRoute', () => {
    expect(proxyConfig.matcher.some((m) => '/api/resend/webhook'.startsWith(m.replace('/:path*', '')))).toBe(false);
  });
});
