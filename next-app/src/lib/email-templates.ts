/**
 * The email template registry — which KINDS of template exist and which merge
 * fields each provides (Plans/Signup-Confirmation-Email.md, Patrick 2026-08-25:
 * "Library will be used soon for other emails. Make it open-ended.").
 *
 * `email_templates.kind` is a free string in the database; this registry is
 * what makes it mean something: the library page groups by kind and offers
 * "New template" per registered kind, the message editor shows a kind's
 * fields as insert buttons, and a consumer (the signup confirmation today,
 * the newsletter tomorrow) filters the picker to the kinds it accepts. Adding
 * a kind is one entry here — no migration.
 */

export interface TemplateField {
  /** The merge token, without brackets: 'event' → `[event]`. */
  token: string;
  label: string;
}

export interface TemplateKind {
  kind: string;
  label: string;
  /** Which recipients the kind writes to — drives what the renderer may reveal. */
  audience: 'family' | 'leader';
  fields: TemplateField[];
}

/** Shared by both signup kinds. */
const EVENT_FIELDS: TemplateField[] = [
  { token: 'event', label: 'Event title' },
  { token: 'date', label: 'Date (or date range)' },
  { token: 'time', label: 'Start–end time' },
  { token: 'location', label: 'Location' },
  { token: 'map', label: 'Google Maps link' },
  { token: 'deadline', label: 'Signup deadline' },
  { token: 'link', label: 'Event page link' }
];

const SIGNUP_FIELDS: TemplateField[] = [
  { token: 'name', label: 'Who signed up (adult)' },
  { token: 'scouts', label: 'Scouts going' },
  { token: 'adults', label: 'Adults going' },
  { token: 'going', label: 'Headcount for this family' },
  { token: 'guests', label: 'Guests' },
  { token: 'days', label: 'Days chosen' },
  { token: 'jobs', label: 'Jobs claimed' },
  { token: 'rides', label: 'Driving / rides' },
  { token: 'answers', label: 'Question answers' },
  { token: 'notes', label: 'Their notes' },
  { token: 'slip', label: 'Permission slip / AHMR' },
  { token: 'prices', label: 'Price tiers' },
  { token: 'amount_due', label: 'Amount due' },
  { token: 'paid', label: 'Paid so far' },
  { token: 'payment', label: 'Payment instructions' },
  { token: 'changed', label: 'New / Updated / Cancelled' },
  { token: 'changes', label: 'What changed (updates)' },
  { token: 'summary', label: 'The whole signup, as a list' }
];

/** Only a leader may see another family's contact details. */
export const LEADER_ONLY_FIELDS: TemplateField[] = [
  { token: 'household', label: 'Household' },
  { token: 'email', label: 'Their email' },
  { token: 'phone', label: 'Their phone' },
  { token: 'roster_link', label: 'Roster link (admin)' },
  { token: 'headcount', label: 'Event headcount so far' }
];

export const TEMPLATE_KINDS: TemplateKind[] = [
  {
    kind: 'signup.family',
    label: 'Signup — family receipt',
    audience: 'family',
    fields: [...EVENT_FIELDS, ...SIGNUP_FIELDS]
  },
  {
    kind: 'signup.leader',
    label: 'Signup — leader notification',
    audience: 'leader',
    fields: [...EVENT_FIELDS, ...SIGNUP_FIELDS, ...LEADER_ONLY_FIELDS]
  }
];

export function templateKind(kind: string): TemplateKind | undefined {
  return TEMPLATE_KINDS.find((k) => k.kind === kind);
}

export function isTemplateKind(kind: string): boolean {
  return templateKind(kind) !== undefined;
}
