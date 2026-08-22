import { describe, it, expect } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  SITE_TEXT_DEFAULTS,
  SITE_TEXT_KEYS,
  fillTemplate,
  resolveSiteText,
  reminderEmailCopy
} from '../src/lib/site-text';

/**
 * Editable site text (Patrick, 2026-08-21: the event-reminder follow-up
 * email "should be in the lookups section of the admin so that text can be
 * edited"). Stored per key in `site_settings` (value only — blank/missing
 * means the built-in default, same contract as article typography);
 * templates use {placeholders} that the sender fills. The email renderer
 * (lib/email renderEmail) is unchanged — only its copy is now data.
 */
describe('site text — templates (pure)', () => {
  it('FillTemplate_ReplacesKnownPlaceholders_AndLeavesUnknownOnesVisible', () => {
    expect(fillTemplate('Are you coming to {title}? Closes {deadline}.', { title: 'Fall Campout', deadline: 'Friday' })).toBe(
      'Are you coming to Fall Campout? Closes Friday.'
    );
    expect(fillTemplate('Hi {name}', { title: 'x' })).toBe('Hi {name}');
  });

  it('ResolveSiteText_UsesTheStoredValue_OrTheDefaultWhenBlankOrMissing', () => {
    const stored = new Map([['reminder_email.subject', 'Custom — {title}?']]);
    expect(resolveSiteText(stored, 'reminder_email.subject')).toBe('Custom — {title}?');
    expect(resolveSiteText(new Map([['reminder_email.subject', '   ']]), 'reminder_email.subject')).toBe(
      SITE_TEXT_DEFAULTS['reminder_email.subject']
    );
    expect(resolveSiteText(new Map(), 'reminder_email.intro')).toBe(SITE_TEXT_DEFAULTS['reminder_email.intro']);
  });

  it('ReminderEmailCopy_FillsEveryPart_FromDefaults', () => {
    const copy = reminderEmailCopy(new Map(), { title: 'Fall Campout', deadline: 'Friday, October 2 at 9:00 PM' });
    expect(copy.subject).toContain('Fall Campout');
    expect(copy.heading).toContain('Fall Campout');
    expect(copy.intro).toContain('Fall Campout');
    expect(copy.bullet).toContain('Friday, October 2 at 9:00 PM');
    expect(copy.outro.length).toBeGreaterThan(0);
    expect(copy.actionLabel.length).toBeGreaterThan(0);
  });

  it('SiteTextKeys_EveryKeyHasADefault_AndALabel', () => {
    for (const k of SITE_TEXT_KEYS) {
      expect(SITE_TEXT_DEFAULTS[k.key].length).toBeGreaterThan(0);
      expect(k.label.length).toBeGreaterThan(0);
    }
  });
});

describe('site_settings table (db)', () => {
  it('SiteSettings_UpsertsByKey_AndReadsBack', async () => {
    const admin = adminClient();
    const key = 'zz_vitest.probe';
    try {
      const up = await admin.from('site_settings').upsert({ key, value: 'one', updated_by: 'vitest' });
      expect(up.error).toBeNull();
      const up2 = await admin.from('site_settings').upsert({ key, value: 'two', updated_by: 'vitest' });
      expect(up2.error).toBeNull();
      const { data } = await admin.from('site_settings').select('value').eq('key', key).single();
      expect(data?.value).toBe('two');
    } finally {
      await admin.from('site_settings').delete().eq('key', key);
    }
  });
});
