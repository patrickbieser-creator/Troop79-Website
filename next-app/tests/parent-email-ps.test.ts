import { describe, it, expect } from 'vitest';
import { scoutEmailPs } from '../src/lib/parent-email';

/**
 * Parent meeting emails end with a P.S. when a scout they name has no email address on file (Patrick, 2026-10-22):
 * it names the scout(s) by first name, never a gendered pronoun, and links the member page where a parent adds it.
 * The senders' half (who gets it, the scout's own copy) is in meeting-reminders-send / build-plan-invite-send.
 */
const URL = 'https://www.troop-79.com/profile';

describe('scoutEmailPs', () => {
  it('OneScout_NamesThemTwice_NoPronoun', () => {
    expect(scoutEmailPs(['Anjali'], URL)).toBe(
      `P.S. If Anjali has an email address, you’re welcome to add it on your [member page](${URL}) so Anjali can get these emails directly. You’ll keep getting a copy.`
    );
  });

  it('TwoScouts_AreNamedTogether', () => {
    expect(scoutEmailPs(['Anjali', 'Leo'], URL)?.startsWith('P.S. If Anjali or Leo has an email address, you’re welcome to add it on your')).toBe(true);
  });

  it('ThreeScouts_CommaThenOr', () => {
    expect(scoutEmailPs(['Anjali', 'Leo', 'Sam'], URL)?.startsWith('P.S. If Anjali, Leo or Sam has')).toBe(true);
  });

  it('NoScouts_NoPs', () => {
    expect(scoutEmailPs([], URL)).toBeNull();
  });
});
