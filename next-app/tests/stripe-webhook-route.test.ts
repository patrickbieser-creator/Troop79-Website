import { describe, it, expect, afterEach, vi } from 'vitest';
import Stripe from 'stripe';
import { config as proxyConfig } from '../src/proxy';

/**
 * The Stripe webhook route (Plans/Wreath-Stripe-Checkout.md): every request must carry a valid Stripe signature, the
 * route fails CLOSED when the secret isn't configured (OMG's route accepted unsigned events in that case — qa-lead),
 * and the admin-only proxy never stands in front of it.
 */
const SECRET = 'whsec_vitest_secret';
const signer = new Stripe('sk_test_vitest');
// The SDK's types list every option, but at runtime timestamp / scheme / signature default — payload + secret suffice.
const sign = (payload: string, secret: string) =>
  signer.webhooks.generateTestHeaderString({ payload, secret } as Parameters<typeof signer.webhooks.generateTestHeaderString>[0]);

async function post(body: string, headers: Record<string, string> = {}) {
  const { POST } = await import('../src/app/api/stripe/webhook/route');
  return POST(new Request('https://wreaths.test/api/stripe/webhook', { method: 'POST', body, headers }));
}
const eventBody = JSON.stringify({ id: 'evt_vitest_route', object: 'event', type: 'customer.created', data: { object: { id: 'cus_x' } } });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/stripe/webhook', () => {
  it('Webhook_FailsClosed_WhenTheSecretIsNotConfigured', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_vitest');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    expect((await post(eventBody, { 'stripe-signature': 't=1,v1=x' })).status).toBe(503);
  });

  it('Webhook_RejectsAMissingSignature', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_vitest');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
    expect((await post(eventBody)).status).toBe(400);
  });

  it('Webhook_RejectsABadSignature', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_vitest');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
    const header = sign(eventBody, 'whsec_someone_else');
    expect((await post(eventBody, { 'stripe-signature': header })).status).toBe(400);
  });

  it('Webhook_AcceptsAValidlySignedEvent', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_vitest');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
    const header = sign(eventBody, SECRET);
    expect((await post(eventBody, { 'stripe-signature': header })).status).toBe(200);
  });

  it('Webhook_ProxyDoesNotGate_ApiRoute', () => {
    expect(proxyConfig.matcher.some((m) => '/api/stripe/webhook'.startsWith(m.replace('/:path*', '')))).toBe(false);
  });
});
