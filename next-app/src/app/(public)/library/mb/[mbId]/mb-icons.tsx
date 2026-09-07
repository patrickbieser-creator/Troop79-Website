/**
 * The three row-action glyphs of the consolidated Requirements list
 * (prototypes/library-mb/index.html, rev 4). Inline SVG on currentColor so a
 * class sets the colour; `aria-hidden` because the button that wraps each
 * one carries the accessible name. No 'use client' — plain functions, drawn
 * by the server-rendered legend and the client-rendered rows alike.
 */

const COMMON = {
  viewBox: '0 0 16 16',
  width: 15,
  height: 15,
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false
} as const;

/** A paperclip — "View resources". */
export function IconResources() {
  return (
    <svg {...COMMON} strokeWidth={1.6}>
      <path d="M10.6 5.4 6.2 9.8a1.5 1.5 0 0 0 2.1 2.1l5-5a3 3 0 0 0-4.2-4.2L3.5 8.3a4.5 4.5 0 0 0 6.4 6.4l3.3-3.3" />
    </svg>
  );
}

/** A circled check — "I did this". */
export function IconClaim() {
  return (
    <svg {...COMMON} strokeWidth={1.8}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="m5.2 8.2 1.9 1.9 3.8-4" />
    </svg>
  );
}

/** A plus — "Suggest a resource". */
export function IconSuggest() {
  return (
    <svg {...COMMON} strokeWidth={1.8}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}
