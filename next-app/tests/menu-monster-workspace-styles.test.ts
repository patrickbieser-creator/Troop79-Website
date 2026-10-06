import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The Menu Monster workspace's calm-list measurements (Patrick 2026-10-02,
 * Jenna's review): tight ~38px rows, quiet sentence-case day headings, one
 * dashed add row, no 44px controls in the list. jsdom can't compute CSS, so
 * the stylesheet is the contract.
 */

const css = fs.readFileSync(
  path.join(__dirname, '../src/app/(public)/library/menu-monster/menus/_components/workspace.module.css'),
  'utf8'
);
const rule = (selector: string): string => {
  const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.+]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
};

describe('workspace.module.css', () => {
  it('DayHeading_IsSentenceCase_14px_Semibold_AndMuted', () => {
    const r = rule('.dayHead');
    expect(r).toMatch(/font-size:\s*14px/);
    expect(r).toMatch(/font-weight:\s*600/);
    expect(r).not.toMatch(/uppercase|letter-spacing/);
  });

  it('DayHeading_HasNoFirstOfTypeSpecialCase', () => {
    expect(css).not.toMatch(/first-of-type/);
  });

  it('Days_AreSpacedByTheirOwnBlock', () => {
    expect(rule('.dayBlock + .dayBlock')).toMatch(/margin-top:\s*var\(--sp-5\)/);
  });

  it('RowMenuButton_Is36pxAndRowMainPadsThreePixels', () => {
    expect(rule('.menuBtn')).toMatch(/min-height:\s*36px/);
    expect(rule('.rowMain')).toMatch(/padding:\s*3px 0/);
  });

  it('DaySearchRow_HasOneDashedBorder_AndNo44pxHeight', () => {
    expect(rule('.addRow')).not.toMatch(/dashed/);
    expect(rule('.addInput')).toMatch(/dashed/);
    expect(rule('.addInput')).not.toMatch(/44px/);
  });

  it('PlusAddAMeal_ButtonAndPopover_AreGone', () => {
    expect(css).not.toMatch(/\.addBtn|\.addPop/);
  });

  it('QuietLink_AndAddSelect_AreGone', () => {
    expect(css).not.toMatch(/\.quietLink|\.addSelect/);
  });

  it('PlanBasics_KeepTheNameAndPickersNarrow_SoOnlyTheDialerLineUsesTheFullWidth', () => {
    expect(rule('.basicsTop')).toMatch(/max-width:\s*\d+px/);
  });

  it('PlanGrid_PutsTheShoppingColumnAt300px_OnlyFromTheDesktopBreakpoint', () => {
    expect(css).toMatch(/@media \(min-width: 900px\)\s*\{\s*\.grid \{ grid-template-columns: minmax\(0, 1fr\) 300px; \}/);
  });

  it('ShoppingPrint_HidesTheControls_AndTheInsets', () => {
    const print = css.slice(css.indexOf('@media print'));
    for (const sel of ['.tabs', '.actions', '.seg', '.inset']) expect(print).toContain(sel);
  });

  it('ShoppingChips_AreAtLeast32pxTall_WithAPressedState', () => {
    expect(rule('.chip')).toMatch(/min-height:\s*32px/);
    expect(css).toMatch(/\.chip\[aria-pressed='true'\]/);
  });

  it('CostLine_CompactReadout_IsHiddenFromDesktopWidth', () => {
    expect(css).toMatch(/@media \(min-width: 900px\) \{ \.costCompact \{ display: none; \} \}/);
  });
});
