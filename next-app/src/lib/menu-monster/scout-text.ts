/**
 * Text a scout typed, as it may be stored and shown to the troop (D-301): no
 * control characters, no links, no zero-width or bidi-override characters,
 * single spaces. Its own module so menus.ts and scout-recipes.ts can both use it
 * without importing each other.
 */

const CONTROL = /[\u0000-\u001F\u007F]/g;
const LINK = /(https?:\/\/|www\.)\S*/gi;
/** Zero-width and bidi-override characters: hidden or spoofed text (mm_scout_text_ok refuses them too). */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Scout text as it may be stored and shown: no control characters, no links, single spaces, within `max`. */
export function cleanScoutText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(INVISIBLE, '').replace(CONTROL, ' ').replace(LINK, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}
