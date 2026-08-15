import { describe, it, expect, afterEach } from 'vitest';
import { applyRedirect, troopEmail } from '../src/lib/email';

/**
 * The dev relay (lib/email.ts rule 5) is the guard that stands between a
 * developer holding a live Resend key and 25 real family addresses. Testing
 * the family sign-in flow REQUIRES real sends — a login code cannot be
 * dry-run — so this is the only thing preventing a local test run from
 * mailing the troop.
 *
 * `applyRedirect` is pure and takes its target as an argument precisely so it
 * can be tested without touching process.env or the network.
 */

describe('applyRedirect — the dev mail relay', () => {
  const subject = 'Your Troop 79 sign-in code';

  it('passes recipients through untouched when no relay is configured', () => {
    const out = applyRedirect(['parent@example.com'], subject, undefined);
    expect(out.to).toEqual(['parent@example.com']);
    expect(out.subject).toBe(subject);
    expect(out.redirectedFrom).toBeUndefined();
  });

  it('treats an empty or whitespace-only relay as unset, not as a recipient', () => {
    // A blank EMAIL_REDIRECT_TO in .env must not rewrite mail to "".
    for (const blank of ['', '   ']) {
      const out = applyRedirect(['parent@example.com'], subject, blank);
      expect(out.to).toEqual(['parent@example.com']);
      expect(out.redirectedFrom).toBeUndefined();
    }
  });

  it('rewrites every recipient to the relay address', () => {
    const out = applyRedirect(['a@example.com', 'b@example.com'], subject, 'dev@example.com');
    expect(out.to).toEqual(['dev@example.com']);
  });

  it('records who the mail was meant for', () => {
    const out = applyRedirect(['a@example.com', 'b@example.com'], subject, 'dev@example.com');
    expect(out.redirectedFrom).toEqual(['a@example.com', 'b@example.com']);
  });

  it('names the intended recipient in the subject so a fan-out is legible in one inbox', () => {
    const out = applyRedirect(['a@example.com', 'b@example.com'], subject, 'dev@example.com');
    expect(out.subject).toBe(`[test→a@example.com, b@example.com] ${subject}`);
  });

  it('normalizes the relay address so a stray capital or space still traps the mail', () => {
    const out = applyRedirect(['a@example.com'], subject, '  DEV@Example.COM  ');
    expect(out.to).toEqual(['dev@example.com']);
  });

  it('never leaves a real address in the recipient list', () => {
    const real = ['parent1@example.com', 'parent2@example.com', 'parent3@example.com'];
    const out = applyRedirect(real, subject, 'dev@example.com');
    for (const address of real) {
      expect(out.to).not.toContain(address);
    }
  });
});

describe('troopEmail', () => {
  const original = process.env.TROOP_NOTIFICATION_EMAIL;
  afterEach(() => {
    if (original === undefined) delete process.env.TROOP_NOTIFICATION_EMAIL;
    else process.env.TROOP_NOTIFICATION_EMAIL = original;
  });

  it("defaults to the troop's own inbox, so production is unchanged by the refactor", () => {
    delete process.env.TROOP_NOTIFICATION_EMAIL;
    expect(troopEmail()).toBe('bsatroop79bg@gmail.com');
  });

  it('honours an override so a dev box does not mail the troop', () => {
    process.env.TROOP_NOTIFICATION_EMAIL = 'dev@example.com';
    expect(troopEmail()).toBe('dev@example.com');
  });

  it('falls back to the default when the override is blank rather than mailing nobody', () => {
    process.env.TROOP_NOTIFICATION_EMAIL = '';
    expect(troopEmail()).toBe('bsatroop79bg@gmail.com');
  });
});
