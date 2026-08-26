import { describe, it, expect } from 'vitest';
import { emailConfigured, sendEmail } from '../src/lib/email';

/**
 * The guard behind vitest.config.ts: a test run must never reach Resend.
 * Seven `[test→…]` relay emails per `npm run test` were landing in Patrick's
 * Gmail (2026-08-25) once a live key sat in .env.local. Unless a developer
 * sets EMAIL_LIVE_TESTS=1 on purpose, the sender is unconfigured here.
 */
describe('email under vitest', () => {
  it('SendEmail_IsUnconfiguredAndSkips_UnlessLiveTestsOptedIn', async () => {
    if (process.env.EMAIL_LIVE_TESTS === '1') return;
    expect(emailConfigured()).toBe(false);
    const res = await sendEmail({ to: ['parent@example.com'], subject: 'x', html: '<p>x</p>', text: 'x', confirm: true });
    expect(res.status).toBe('skipped');
  });
});
