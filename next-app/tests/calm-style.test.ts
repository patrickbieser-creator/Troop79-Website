import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Calm Site Restyle (Plans/Calm-Site-Restyle.md, sweep: Plans/Calm-Site-Restyle-Sweep.md).
 * The Menu Monster look carried to the shared kit: no uppercase tracked labels,
 * no hairline-bordered cards, no 2px header rules, quiet notices and badges,
 * text tabs. These lock each release's shared stylesheets so a later edit can't
 * quietly bring the loud patterns back. Grep-shaped, like the design-system census.
 */

const KIT = path.join(__dirname, '..', 'src', 'app', '_components');
const css = (name: string) => fs.readFileSync(path.join(KIT, `${name}.module.css`), 'utf8');
/** The declarations of one rule (first match), comments stripped. */
const rule = (src: string, selector: string) => {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = clean.match(new RegExp(`(^|\\n)\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
  return m ? m[2] : null;
};

const R1 = ['form', 'page-header', 'section-divider', 'card', 'notice', 'badge', 'tab-strip'];

describe('Calm style — R1 public kit', () => {
  it.each(R1)('%s_HasNoUppercaseLabels', (name) => {
    expect(css(name).replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/text-transform:\s*uppercase/);
  });

  it.each(R1)('%s_HasNoWideLetterSpacing', (name) => {
    const spacings = [...css(name).matchAll(/letter-spacing:\s*([\d.]+)em/g)].map((m) => Number(m[1]));
    expect(spacings.filter((v) => v > 0.02)).toEqual([]);
  });

  it('Card_HasNoBorder', () => {
    expect(rule(css('card'), '.card')).not.toMatch(/border\s*:/);
  });

  it('Card_OffersTheTightListRecipe', () => {
    expect(rule(css('card'), '.listRow')).toMatch(/min-height:\s*38px/);
  });

  it('FormCard_HasNoBorder', () => {
    expect(rule(css('form'), '.formCard')).not.toMatch(/border\s*:/);
  });

  it('FieldLabel_IsAQuietSentenceCaseLabel', () => {
    expect(rule(css('form'), '.fieldLabel')).toMatch(/font-size:\s*14px/);
  });

  it('Inputs_KeepTheSixteenPixelFloor', () => {
    expect(css('form')).toMatch(/font-size:\s*16px/);
  });

  it('PageHeader_HasNoHeaderRule', () => {
    expect(css('page-header')).not.toMatch(/\.headRule/);
  });

  it('PageTitle_IsNotTheHeavyDisplayWeight', () => {
    expect(rule(css('page-header'), '.pageTitle')).not.toMatch(/font-weight:\s*900/);
  });

  it('Notice_DrawsABorderOnlyForErrors', () => {
    const src = css('notice');
    expect(['.notice', '.success', '.warning', '.info'].filter((sel) => /border\s*:/.test(rule(src, sel) ?? ''))).toEqual([]);
  });

  it('Badge_HasNoBorder', () => {
    expect(css('badge').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/border\s*:/);
  });

  it('TabStrip_TabsHaveNoBoxBorder', () => {
    expect(rule(css('tab-strip'), '.tab')).not.toMatch(/border\s*:\s*1px/);
  });

  it('SectionDivider_HasNoDrawnRule', () => {
    expect(rule(css('section-divider'), '.rule')).not.toMatch(/background/);
  });
});

/** A screen stylesheet under src/app, by path. */
const APP = path.join(__dirname, '..', 'src', 'app');
const screenCss = (rel: string) => fs.readFileSync(path.join(APP, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const wideTracking = (src: string) => [...src.matchAll(/letter-spacing:\s*([\d.]+)em/g)].map((m) => Number(m[1])).filter((v) => v > 0.02);

/** Each release's screen stylesheets: no uppercase labels, no wide tracking, no 1.5px/2px drawn rules. */
const SCREENS: Record<string, string[]> = {
  R3: [
    '(public)/events/events.module.css',
    '(public)/events/[id]/event-detail.module.css',
    '(public)/profile/profile.module.css',
    '(public)/member/member.module.css',
    '(public)/signin/signin.module.css'
  ]
};

describe.each(Object.entries(SCREENS))('Calm style — %s screens', (_release, files) => {
  it.each(files)('%s_HasNoUppercaseLabels', (rel) => {
    expect(screenCss(rel)).not.toMatch(/text-transform:\s*uppercase/);
  });

  it.each(files)('%s_HasNoWideLetterSpacing', (rel) => {
    expect(wideTracking(screenCss(rel))).toEqual([]);
  });

  it.each(files)('%s_HasNoHeavyRules', (rel) => {
    // Focus outlines are allowed; drawn borders of 1.5px / 2px are the loud pattern.
    expect(screenCss(rel).match(/border(?:-(?:top|bottom|left|right))?:\s*(?:1\.5|2)px solid[^;]*/g) ?? []).toEqual([]);
  });
});

describe('Calm style — R2 public Button', () => {
  it('Button_HasNoUppercaseLabels', () => {
    expect(css('button').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/text-transform:\s*uppercase/);
  });

  it('Button_IsThirtySixPixelsTall_ByDefault', () => {
    expect(rule(css('button'), '.btn')).toMatch(/min-height:\s*36px/);
  });

  it('Button_HasNoWideLetterSpacing', () => {
    const spacings = [...css('button').matchAll(/letter-spacing:\s*([\d.]+)em/g)].map((m) => Number(m[1]));
    expect(spacings.filter((v) => v > 0.02)).toEqual([]);
  });
});
