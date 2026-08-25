/**
 * The admin help map — every ? badge's copy, in one file, keyed by id
 * (Patrick, 2026-08-25: "central help.ts" so the instructions can be reviewed
 * in one place rather than hunted across call sites).
 *
 * Keys are `{screen}.{thing}`. Bodies are JSX so an entry can carry a list,
 * emphasis or a link out (Patrick: "rich content"); keep them to reference
 * material — what a symbol means, how a number is computed. Anything a
 * leader must know BEFORE acting stays visible on the screen (AGENTS.md →
 * On-screen instructions).
 *
 * Rendered by `_components/help-badge.tsx`. Specimens and the tuning page:
 * /admin/styleguide/help-sample.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';

export interface HelpEntry {
  /** Short noun phrase — the popover heading and the badge's accessible name. */
  title: string;
  body: ReactNode;
}

export const HELP = {
  'calendar.status': {
    title: 'Status pills',
    body: (
      <>
        <p>What each entry carries. Click a pill to open that layer.</p>
        <dl>
          <dt>A</dt>
          <dd>Agenda — green when published, yellow while a draft.</dd>
          <dt>S</dt>
          <dd>Signup — green when open, yellow while a draft, grey once closed.</dd>
          <dt>R</dt>
          <dd>Roll call taken — the count is on hover.</dd>
          <dt>O</dt>
          <dd>Off the calendar — only shown when an entry is not published to the public calendar.</dd>
        </dl>
      </>
    )
  },
  'calendar.going': {
    title: 'Going',
    body: (
      <p>
        People signed up as <strong>yes</strong> for the whole event, guests included — the same count the
        roster uses. Blank when nobody has, or when the entry has no signup.
      </p>
    )
  },
  'calendar.on-calendar': {
    title: 'On the calendar',
    body: (
      <p>
        On-calendar entries feed the public calendar and the .ics subscription. Turn it off for things that
        happen on a date but should not be published — a leader meeting, an outside opportunity you are only
        tracking.
      </p>
    )
  },
  'calendar.promote': {
    title: 'Promote to the homepage',
    body: (
      <p>
        Any entry can appear in the homepage news feed for a window. Turning it off parks the window rather than
        clearing it, so turning it back on restores the setup.
      </p>
    )
  },
  'sample.short': {
    title: 'Short help',
    body: <p>This is one sentence of reference material.</p>
  },
  'sample.long': {
    title: 'A long entry',
    body: (
      <>
        <p>
          Some entries need room. This one is about 150 words so you can see how the popover handles a
          paragraph, a list and a link — whether it grows, wraps or scrolls, and whether the pointer can travel
          from the badge onto the text without it closing.
        </p>
        <ul>
          <li>Counts are recomputed every time the page loads; nothing is cached.</li>
          <li>Guests are included when the household added them to the signup.</li>
          <li>Waitlisted replies are not counted until a seat opens and they are moved to yes.</li>
          <li>A cancelled reply drops out immediately.</li>
        </ul>
        <p>
          Money, cars and tents are on the event&rsquo;s own pages, one click from its{' '}
          <Link href="/admin/calendar">Signup tab</Link>. If the number here and the roster disagree, reload
          the page before reporting it.
        </p>
      </>
    )
  }
} satisfies Record<string, HelpEntry>;

export type HelpId = keyof typeof HELP;
