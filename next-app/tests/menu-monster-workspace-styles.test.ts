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

  it('AddMealRow_HasOneDashedBorder_AndNo44pxHeight', () => {
    expect(rule('.addRow')).not.toMatch(/dashed/);
    expect(rule('.addBtn')).toMatch(/dashed/);
    expect(rule('.addBtn')).not.toMatch(/44px/);
  });

  it('QuietLink_AndAddSelect_AreGone', () => {
    expect(css).not.toMatch(/\.quietLink|\.addSelect/);
  });
});
