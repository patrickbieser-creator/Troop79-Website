/**
 * Editable site text (Patrick, 2026-08-21): copy that leaders should be able
 * to change without a deploy — first the event-reminder follow-up email
 * ("Chase the non-responders"). Stored by key in `site_settings`; a missing
 * or blank value means the built-in default below (the article-typography
 * contract). Templates carry {placeholders} the sender fills at send time.
 *
 * Pure helpers here (tested in tests/site-text.test.ts); the one DB read,
 * loadSiteText(), is a thin wrapper so both the sender and the Lookups
 * editor share the same source.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type SiteTextKey =
  | 'reminder_email.subject'
  | 'reminder_email.heading'
  | 'reminder_email.intro'
  | 'reminder_email.bullet'
  | 'reminder_email.action_label'
  | 'reminder_email.outro';

export interface SiteTextKeyDef {
  key: SiteTextKey;
  label: string;
  /** Short hint shown under the field in Lookups. */
  hint: string;
  /** Multi-line textarea vs single-line input. */
  multiline: boolean;
}

/** The placeholders the reminder email supports — documented in the editor. */
export const REMINDER_EMAIL_PLACEHOLDERS = ['{title}', '{deadline}'] as const;

export const SITE_TEXT_KEYS: readonly SiteTextKeyDef[] = [
  { key: 'reminder_email.subject', label: 'Subject line', hint: 'Placeholders: {title}', multiline: false },
  { key: 'reminder_email.heading', label: 'Heading', hint: 'The big line at the top of the email. Placeholders: {title}', multiline: false },
  { key: 'reminder_email.intro', label: 'Opening paragraph', hint: 'Placeholders: {title}', multiline: true },
  { key: 'reminder_email.bullet', label: 'Deadline line', hint: 'Shown as a bullet. Placeholders: {deadline}', multiline: false },
  { key: 'reminder_email.action_label', label: 'Button label', hint: 'The button links to the event’s sign-up page.', multiline: false },
  { key: 'reminder_email.outro', label: 'Closing line', hint: 'Shown under the button.', multiline: true }
];

export const SITE_TEXT_DEFAULTS: Record<SiteTextKey, string> = {
  'reminder_email.subject': 'Troop 79 — are you coming to {title}?',
  'reminder_email.heading': "We haven't heard from you about {title}",
  'reminder_email.intro':
    "We're finalising numbers for {title} and don't have an answer from your family yet. " +
    'Even a "can\'t make it" helps — it tells the planners who not to wait for.',
  'reminder_email.bullet': 'Signups close {deadline}.',
  'reminder_email.action_label': 'Sign up or decline',
  'reminder_email.outro': 'If you have already replied, thank you — please ignore this.'
};

/** Replace {name} placeholders from `vars`; unknown ones stay visible so a
 *  typo in the admin editor shows up in the preview instead of vanishing. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (m, name: string) => (name in vars ? vars[name] : m));
}

/** Stored value if non-blank, else the default. */
export function resolveSiteText(stored: ReadonlyMap<string, string>, key: SiteTextKey): string {
  const v = stored.get(key);
  return v && v.trim() ? v : SITE_TEXT_DEFAULTS[key];
}

export interface ReminderEmailCopy {
  subject: string;
  heading: string;
  intro: string;
  bullet: string;
  actionLabel: string;
  outro: string;
}

/** The reminder email's copy, resolved and filled. */
export function reminderEmailCopy(
  stored: ReadonlyMap<string, string>,
  vars: { title: string; deadline: string }
): ReminderEmailCopy {
  const v: Record<string, string> = { title: vars.title, deadline: vars.deadline };
  return {
    subject: fillTemplate(resolveSiteText(stored, 'reminder_email.subject'), v),
    heading: fillTemplate(resolveSiteText(stored, 'reminder_email.heading'), v),
    intro: fillTemplate(resolveSiteText(stored, 'reminder_email.intro'), v),
    bullet: fillTemplate(resolveSiteText(stored, 'reminder_email.bullet'), v),
    actionLabel: fillTemplate(resolveSiteText(stored, 'reminder_email.action_label'), v),
    outro: fillTemplate(resolveSiteText(stored, 'reminder_email.outro'), v)
  };
}

/** All stored overrides (service-role client). Never throws — a read failure
 *  degrades to the defaults, which is exactly what an empty map means. */
export async function loadSiteText(admin: SupabaseClient): Promise<Map<string, string>> {
  try {
    const { data } = await admin.from('site_settings').select('key, value');
    return new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  } catch {
    return new Map();
  }
}
