import { describe, it, expect, afterEach } from 'vitest';
import {
  SUGGESTION_MAX,
  buildSuggestionEmail,
  suggestionRecipients,
  validateSuggestion
} from '../src/lib/suggestion-email';

/**
 * "Make a Suggestion" on the Leader Dashboard (Patrick, 2026-08-28): a
 * signed-in leader's website feedback goes to the troop inbox AND to
 * Patrick. The pure half — who gets it, what it says, what is rejected —
 * lives in lib/suggestion-email so it is testable without a session.
 */

const ORIG_OWNER = process.env.SUGGESTION_OWNER_EMAIL;
const ORIG_TROOP = process.env.TROOP_NOTIFICATION_EMAIL;
afterEach(() => {
  if (ORIG_OWNER === undefined) delete process.env.SUGGESTION_OWNER_EMAIL;
  else process.env.SUGGESTION_OWNER_EMAIL = ORIG_OWNER;
  if (ORIG_TROOP === undefined) delete process.env.TROOP_NOTIFICATION_EMAIL;
  else process.env.TROOP_NOTIFICATION_EMAIL = ORIG_TROOP;
});

describe('suggestionRecipients', () => {
  it('Recipients_AreTroopInboxAndOwner_WhenNothingOverridden', () => {
    delete process.env.SUGGESTION_OWNER_EMAIL;
    delete process.env.TROOP_NOTIFICATION_EMAIL;
    expect(suggestionRecipients()).toEqual(['bsatroop79bg@gmail.com', 'patrickbieser@gmail.com']);
  });

  it('Recipients_HonorEnvOverrides_WhenSet', () => {
    process.env.TROOP_NOTIFICATION_EMAIL = 'troop@example.com';
    process.env.SUGGESTION_OWNER_EMAIL = 'owner@example.com';
    expect(suggestionRecipients()).toEqual(['troop@example.com', 'owner@example.com']);
  });
});

describe('validateSuggestion', () => {
  it('Validate_RejectsBlank_WhenOnlyWhitespace', () => {
    expect(validateSuggestion('   \n ')).toEqual({ ok: false, error: 'Please write your suggestion first.' });
  });

  it('Validate_RejectsTooLong_WhenOverMax', () => {
    const r = validateSuggestion('x'.repeat(SUGGESTION_MAX + 1));
    expect(r.ok).toBe(false);
  });

  it('Validate_TrimsText_WhenValid', () => {
    expect(validateSuggestion('  Add a dark mode.  ')).toEqual({ ok: true, text: 'Add a dark mode.' });
  });
});

describe('buildSuggestionEmail', () => {
  it('Email_NamesTheLeaderInSubjectAndBody_WhenBuilt', () => {
    const msg = buildSuggestionEmail({
      name: 'Becky Vest',
      email: 'becky@example.com',
      text: 'The roster search should remember my last tab.'
    });
    expect(msg.subject).toBe('Website suggestion from Becky Vest');
    expect(msg.text).toContain('Becky Vest');
    expect(msg.text).toContain('becky@example.com');
    expect(msg.text).toContain('The roster search should remember my last tab.');
    expect(msg.replyTo).toBe('becky@example.com');
  });

  it('Email_EscapesHtml_WhenSuggestionContainsMarkup', () => {
    const msg = buildSuggestionEmail({ name: 'A', email: null, text: '<script>alert(1)</script>' });
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('&lt;script&gt;');
  });

  it('Email_HasNoReplyTo_WhenLeaderHasNoEmail', () => {
    const msg = buildSuggestionEmail({ name: 'A', email: null, text: 'hi' });
    expect(msg.replyTo).toBeUndefined();
    expect(msg.text).toContain('no email on file');
  });
});
