/**
 * Verify the outbound email wiring end to end.
 *
 *   npm run send-test-email
 *
 * Sends one message through the real lib/email.ts path — same Resend client,
 * same EMAIL_FROM, same relay — so a pass proves the API key is valid, the
 * sender's domain is verified, and the message actually lands. Reach for this
 * whenever mail stops working, before digging into any individual flow.
 *
 * SAFETY: refuses to run unless EMAIL_REDIRECT_TO is set. This script exists
 * to be run casually while debugging, which is exactly the situation in which
 * a tool that CAN mail a real family eventually will. With the relay on, the
 * only reachable address is the developer's own.
 */

import { sendEmail, renderEmail, emailConfigured } from '../src/lib/email';

/** Deliberately not a real address — proves the relay rewrote the recipient. */
const FAKE_RECIPIENT = 'not-a-real-family@example.invalid';

async function main() {
  const relay = (process.env.EMAIL_REDIRECT_TO ?? '').trim();
  if (!relay) {
    console.error(
      'Refusing to run: EMAIL_REDIRECT_TO is not set.\n' +
        'Without it this script would mail whatever address it is given for real.\n' +
        'Set EMAIL_REDIRECT_TO=you@example.com in .env.local and try again.'
    );
    process.exit(1);
  }

  if (!emailConfigured()) {
    console.error(
      'Email is not configured: RESEND_API_KEY and/or EMAIL_FROM is unset in .env.local.\n' +
        'sendEmail() would report "skipped" and nothing would leave the building.'
    );
    process.exit(1);
  }

  console.log(`from:  ${process.env.EMAIL_FROM}`);
  console.log(`relay: ${relay}`);
  console.log(`asking to send to the fake address ${FAKE_RECIPIENT} …\n`);

  const { html, text } = renderEmail({
    heading: 'Email wiring test',
    intro:
      'If you are reading this, the Resend key is valid, the sender domain is verified, and the dev relay rewrote the recipient before sending.',
    bullets: [
      `Intended recipient: ${FAKE_RECIPIENT} (fake, on purpose)`,
      `Actually delivered to: ${relay}`,
      `Sent from: ${process.env.EMAIL_FROM}`
    ],
    outro: 'Nothing was written to the database. This message is the whole test.'
  });

  const result = await sendEmail({
    to: [FAKE_RECIPIENT],
    subject: 'Troop 79 — email wiring test',
    html,
    text,
    confirm: true
  });

  console.log(JSON.stringify(result, null, 2));

  if (result.status !== 'sent') {
    console.error(`\nFAILED — status "${result.status}". ${result.detail ?? ''}`);
    process.exit(1);
  }
  if (!result.redirectedFrom?.includes(FAKE_RECIPIENT)) {
    console.error('\nFAILED — the relay did not report rewriting the recipient.');
    process.exit(1);
  }
  if (result.to.includes(FAKE_RECIPIENT)) {
    console.error('\nFAILED — the fake address survived into the real recipient list.');
    process.exit(1);
  }
  console.log(`\nOK — sent to ${result.to.join(', ')}. Check that inbox.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
