export type GuestMode = 'none' | 'count' | 'named';
export const GUEST_MODES: readonly GuestMode[] = ['none', 'count', 'named'];
export function isGuestMode(v: unknown): v is GuestMode {
  return typeof v === 'string' && (GUEST_MODES as readonly string[]).includes(v);
}

/**
 * Guests as People (Plans/Guests-As-People.md): the per-category DEFAULT for
 * a new signup's guest mode — a preset, never a lock; the Builder flips it.
 *
 *   count — only the number matters: a Court of Honor family bringing
 *           grandparents, a service project, an outreach night, a brat fry.
 *   named — who they are matters: anything overnight, anything with a price
 *           (a counted guest can't be charged), anything with rides.
 *   none  — everything else.
 */
export const GUEST_MODE_PRESETS: Readonly<Record<string, GuestMode>> = {
  'Ceremony / Recognition': 'count',
  'Service Project': 'count',
  'Recruiting / Outreach': 'count',
  'Social Event': 'count',
  Fundraiser: 'count',
  'Campout / Overnight': 'named',
  'Summer Camp': 'named',
  'High Adventure': 'named'
};

export function guestModePresetFor(category: string | null | undefined): GuestMode {
  return (category && GUEST_MODE_PRESETS[category]) || 'none';
}

/** Family-facing prompt when the leader wrote none. */
export function defaultGuestPrompt(mode: GuestMode): string {
  return mode === 'count' ? 'How many guests are you bringing?' : 'Bringing anyone else?';
}

export const GUEST_MODE_LABEL: Record<GuestMode, string> = {
  none: 'No guests',
  count: 'Count only',
  named: 'Named guests'
};

export const GUEST_MODE_HINT: Record<GuestMode, string> = {
  none: 'Families sign up only the people in their household.',
  count: 'Families give a number ("+3 guests") on their signup — a Court of Honor, a service project.',
  named: 'Each guest is listed by name and class, and becomes a person with a ride, money and a history — campouts, anything priced.'
};

/** The one-line warning the Builder shows when a priced event is in count mode. */
export const COUNT_MODE_PRICE_WARNING =
  'Guests can’t be charged as a count — switch to Named guests to price them.';
