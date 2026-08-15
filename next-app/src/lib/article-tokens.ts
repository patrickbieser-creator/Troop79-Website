/**
 * Article typography tokens — the safe half of "let me edit the CSS".
 *
 * Patrick asked to edit the markdown stylesheet directly. Three things make the
 * literal version a bad trade, none of them about trust:
 *
 *   * On Vercel the filesystem is read-only at runtime, so "edit the file"
 *     really means storing CSS in the database and injecting it — a different
 *     thing with different risks.
 *   * CSS has no syntax gate. One unclosed brace silently swallows every rule
 *     after it, and no build step or test would catch it.
 *   * Injected CSS is an exfiltration surface: `url()` makes requests, and
 *     attribute selectors can leak page content a character at a time.
 *
 * So this exposes VALUES, not rules. Each token has a type, and a value that
 * fails its type is refused — which is what closes the injection hole, because
 * nothing arbitrary ever reaches a stylesheet. `17px` is allowed;
 * `17px; background: url(https://evil)` is not.
 *
 * Adding a token is two lines here plus a `var()` in
 * article-body.module.css — no migration, since storage is key/value.
 *
 * This file imports nothing on purpose: it is used by the admin editor (a
 * Client Component), the server-side loader, and the validating writer.
 */

export type TokenType = 'length' | 'number' | 'keyword';

export interface TokenDef {
  /** Storage key and form field name. */
  key: string;
  /** The CSS custom property the stylesheet reads. */
  cssVar: string;
  label: string;
  hint: string;
  type: TokenType;
  /** What the stylesheet falls back to when nothing is stored. */
  fallback: string;
  /** Allowed values, for `keyword` tokens. */
  options?: string[];
}

export const ARTICLE_TOKENS: TokenDef[] = [
  {
    key: 'body_size',
    cssVar: '--article-body-size',
    label: 'Body text size',
    hint: 'Paragraphs and list items. 17px is the default.',
    type: 'length',
    fallback: '17px'
  },
  {
    key: 'line_height',
    cssVar: '--article-line-height',
    label: 'Line height',
    hint: 'A unitless multiple of the font size — 1.8 is roomy, 1.5 is tight.',
    type: 'number',
    fallback: '1.8'
  },
  {
    key: 'measure',
    cssVar: '--article-measure',
    label: 'Column width',
    hint: 'How wide the prose column runs. Long lines are harder to read.',
    type: 'length',
    fallback: '760px'
  },
  {
    key: 'block_space',
    cssVar: '--article-block-space',
    label: 'Space between blocks',
    hint: 'The gap between paragraphs, lists and images.',
    type: 'length',
    fallback: '20px'
  },
  {
    key: 'h2_size',
    cssVar: '--article-h2-size',
    label: 'Heading size (##)',
    hint: 'The large section headings.',
    type: 'length',
    fallback: '26px'
  },
  {
    key: 'h3_size',
    cssVar: '--article-h3-size',
    label: 'Sub-heading size (###)',
    hint: 'The small uppercase sub-headings.',
    type: 'length',
    fallback: '13px'
  },
  {
    key: 'list_marker',
    cssVar: '--article-list-marker',
    label: 'Bullet style',
    hint: 'The marker on top-level bulleted lists.',
    type: 'keyword',
    fallback: 'disc',
    options: ['disc', 'circle', 'square', 'none']
  },
  {
    key: 'list_item_space',
    cssVar: '--article-list-item-space',
    label: 'Space between list items',
    hint: 'Tighten this for long checklists.',
    type: 'length',
    fallback: '6px'
  }
];

export const TOKEN_BY_KEY = new Map(ARTICLE_TOKENS.map((t) => [t.key, t]));

/**
 * Lengths are a number plus a known unit — nothing else. `calc()`, `var()` and
 * anything containing a semicolon, brace, colon, quote or parenthesis is
 * refused, which is what keeps a value from ever becoming a rule.
 */
const LENGTH_RE = /^\d{1,4}(\.\d{1,2})?(px|rem|em|ch|%)$/;
const NUMBER_RE = /^\d{1,2}(\.\d{1,2})?$/;

/** The single gate every stored value passes, on write AND on render. */
export function isValidTokenValue(def: TokenDef, raw: string): boolean {
  const value = raw.trim();
  if (value === '') return false;
  if (def.type === 'length') return LENGTH_RE.test(value);
  if (def.type === 'number') return NUMBER_RE.test(value);
  return (def.options ?? []).includes(value);
}

export type TokenValues = Record<string, string>;

/**
 * The CSS custom-property block for a set of stored values.
 *
 * Re-validates every value rather than trusting the database. A row edited by
 * hand — or by some future code path that skips the form — must not be able to
 * reach the page, so this is the second of two gates rather than a formality.
 * Anything that fails is simply dropped and the stylesheet's own fallback wins.
 */
export function tokensToCss(values: TokenValues): string {
  const decls: string[] = [];
  for (const def of ARTICLE_TOKENS) {
    const value = values[def.key];
    if (value === undefined) continue;
    if (!isValidTokenValue(def, value)) continue;
    decls.push(`${def.cssVar}:${value.trim()}`);
  }
  return decls.length ? `:root{${decls.join(';')}}` : '';
}
