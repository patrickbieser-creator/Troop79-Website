import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MbProofPicker from '../src/app/(public)/library/mb/[mbId]/mb-proof-picker';

/**
 * Patrick, 2026-08-19: the old two-step "Requirement" -> "Which part?"
 * cascading dropdowns hid every sub-requirement behind a reveal step — he
 * saw only the top-level list and read that as "sub-requirements aren't
 * shown at all." ux-lead recommendation (same session): replace both
 * selects with an always-expanded fieldset-per-top-requirement, radio-per-leaf
 * list, so the full tree is visible with nothing to click to discover.
 *
 * These tests guard the one thing that's easy to break while making that
 * change: every leaf across every group must render on first paint (not
 * after a selection), and the whole tree must still resolve to exactly one
 * leaf code via native radio-group semantics (single shared `name`).
 */

const GROUPS = [
  {
    code: '1',
    label: 'Health and safety',
    leaves: [{ code: '1', label: 'Health and safety' }]
  },
  {
    code: '2',
    label: 'Nutrition',
    leaves: [
      { code: '2a', label: 'Plan a balanced day of meals' },
      { code: '2b', label: 'Explain why to limit intake of trans fats and sugar' },
      { code: '2c', label: 'Track your daily activity and daily calories' }
    ]
  },
  {
    code: '3',
    label: 'Cooking basics',
    leaves: [
      { code: '3a', label: 'Explain cooking methods' },
      { code: '3b', label: 'Demonstrate a cooking technique' }
    ]
  }
];

describe('MbProofPicker', () => {
  it('Picker_ShowsEverySubRequirement_OnFirstRender', () => {
    // No click, no selection — every leaf from every group must already be
    // on the page. This is the exact regression: the old cascading selects
    // only revealed 2a/2b/2c after picking "2" first.
    render(<MbProofPicker mbId="cooking" groups={GROUPS} />);
    expect(screen.getByText(/2a.*Plan a balanced day of meals/)).toBeTruthy();
    expect(screen.getByText(/2b.*trans fats and sugar/)).toBeTruthy();
    expect(screen.getByText(/2c.*daily activity/)).toBeTruthy();
    expect(screen.getByText(/3a.*cooking methods/)).toBeTruthy();
    expect(screen.getByText(/3b.*cooking technique/)).toBeTruthy();
  });

  it('Picker_LabelsEveryGroup_ByItsTopLevelCodeAndLabel', () => {
    render(<MbProofPicker mbId="cooking" groups={GROUPS} />);
    expect(screen.getByText(/2.*Nutrition/)).toBeTruthy();
    expect(screen.getByText(/3.*Cooking basics/)).toBeTruthy();
  });

  it('Picker_RendersASingleLeafGroup_AsOneRadioNotADuplicateHeading', () => {
    // Group "1" has exactly one leaf equal to the group itself — should be
    // one selectable row, not a heading plus a redundant single radio
    // repeating the same text.
    render(<MbProofPicker mbId="cooking" groups={GROUPS} />);
    const matches = screen.getAllByText(/Health and safety/);
    expect(matches).toHaveLength(1);
  });

  it('Picker_KeepsContinueDisabled_UntilALeafIsPicked', () => {
    render(<MbProofPicker mbId="cooking" groups={GROUPS} />);
    expect(screen.queryByRole('link', { name: /continue/i })).toBeNull();
    expect(screen.getByRole('button', { name: /continue/i })).toHaveProperty('disabled', true);
  });

  it('Picker_EnablesContinue_LinkingToTheChosenLeafsSubmitProofTarget', async () => {
    const user = userEvent.setup();
    render(<MbProofPicker mbId="cooking" groups={GROUPS} />);
    await user.click(screen.getByRole('radio', { name: /2b.*trans fats and sugar/ }));
    const link = screen.getByRole('link', { name: /continue/i });
    expect(link.getAttribute('href')).toBe(
      `/library/submit-proof?target=${encodeURIComponent('mb_req:cooking-2b')}`
    );
  });

  it('Picker_AllowsOnlyOneLeafSelectedAtATime_AcrossDifferentGroups', async () => {
    // The whole tree is one radio group (shared `name`) — picking a leaf in
    // group 3 must clear a prior pick in group 2, not just within its own
    // group, since exactly one leaf code is the point of the picker.
    const user = userEvent.setup();
    render(<MbProofPicker mbId="cooking" groups={GROUPS} />);
    const firstPick = screen.getByRole('radio', { name: /2a.*balanced day of meals/ });
    const secondPick = screen.getByRole('radio', { name: /3b.*cooking technique/ });
    await user.click(firstPick);
    expect(firstPick).toHaveProperty('checked', true);
    await user.click(secondPick);
    expect(firstPick).toHaveProperty('checked', false);
    expect(secondPick).toHaveProperty('checked', true);
  });

  it('Picker_ShowsScoutBlockedMessage_InsteadOfAnyRadio_WhenScoutBlocked', () => {
    render(<MbProofPicker mbId="cooking" groups={GROUPS} scoutBlocked />);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText(/can.t be submitted from this login/)).toBeTruthy();
  });
});
