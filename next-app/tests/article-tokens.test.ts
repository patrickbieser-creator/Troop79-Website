import { describe, it, expect } from 'vitest';
import {
  ARTICLE_TOKENS,
  TOKEN_BY_KEY,
  isValidTokenValue,
  tokensToCss
} from '@/lib/article-tokens';

/**
 * Article typography tokens.
 *
 * The validator IS the security boundary. Patrick asked to edit the markdown
 * CSS; what he gets is the VALUES that stylesheet reads, and the only thing
 * standing between a text box and a `<style>` tag on every public article page
 * is `isValidTokenValue`. So the injection cases are tested as hard as the
 * happy path — a value that could carry a rule, a URL, or a second declaration
 * must never survive to `tokensToCss`.
 */

const len = TOKEN_BY_KEY.get('body_size')!;
const num = TOKEN_BY_KEY.get('line_height')!;
const kw = TOKEN_BY_KEY.get('list_marker')!;

describe('token validation', () => {
  it('Length_Accepts_ANumberWithAKnownUnit', () => {
    for (const v of ['17px', '1.1rem', '2em', '65ch', '90%', '0px']) {
      expect(isValidTokenValue(len, v), v).toBe(true);
    }
  });

  it('Length_Rejects_AnythingThatCouldCarryARule', () => {
    for (const v of [
      '17px; background: url(https://evil.example/x)',
      '17px}html{display:none',
      'url(https://evil.example/x)',
      'calc(100% - 10px)',
      'var(--something)',
      'expression(alert(1))',
      '17', // no unit
      '17 px', // space
      'red',
      ''
    ]) {
      expect(isValidTokenValue(len, v), v).toBe(false);
    }
  });

  it('Number_Accepts_APlainMultiple_AndRejectsUnits', () => {
    expect(isValidTokenValue(num, '1.6')).toBe(true);
    expect(isValidTokenValue(num, '2')).toBe(true);
    expect(isValidTokenValue(num, '1.6em')).toBe(false);
    expect(isValidTokenValue(num, '1.6;color:red')).toBe(false);
  });

  it('Keyword_Accepts_OnlyItsOwnOptions', () => {
    for (const o of kw.options ?? []) expect(isValidTokenValue(kw, o)).toBe(true);
    expect(isValidTokenValue(kw, 'disc;color:red')).toBe(false);
    expect(isValidTokenValue(kw, 'lower-roman')).toBe(false); // valid CSS, not offered
  });

  it('EveryTokenFallback_IsItselfValid', () => {
    // A fallback that failed its own validator would mean the panel offers a
    // default it would refuse to save.
    for (const def of ARTICLE_TOKENS) {
      expect(isValidTokenValue(def, def.fallback), def.key).toBe(true);
    }
  });
});

describe('rendering to CSS', () => {
  it('TokensToCss_EmitsOnlyTheValuesGiven', () => {
    const css = tokensToCss({ body_size: '18px', line_height: '1.6' });
    expect(css).toBe(':root{--article-body-size:18px;--article-line-height:1.6}');
  });

  it('TokensToCss_IsEmpty_WhenNothingIsStored', () => {
    // No block at all, so the stylesheet's own defaults apply untouched.
    expect(tokensToCss({})).toBe('');
  });

  it('TokensToCss_DropsAnInvalidValue_EvenIfItReachedStorage', () => {
    // The second gate: a row written by some path that skipped the form must
    // still not reach the page.
    const css = tokensToCss({
      body_size: '18px',
      line_height: '1.6; } html { display: none } .x {'
    });
    expect(css).toBe(':root{--article-body-size:18px}');
    expect(css).not.toContain('display');
  });

  it('TokensToCss_IgnoresAnUnknownKey', () => {
    expect(tokensToCss({ not_a_token: 'anything' })).toBe('');
  });

  it('TokensToCss_NeverEmitsABraceOrSemicolonFromAValue', () => {
    const css = tokensToCss({
      body_size: '16px',
      measure: '700px',
      list_marker: 'square'
    });
    // Exactly one opening and one closing brace — the ones this function writes.
    expect((css.match(/\{/g) ?? []).length).toBe(1);
    expect((css.match(/\}/g) ?? []).length).toBe(1);
  });
});
