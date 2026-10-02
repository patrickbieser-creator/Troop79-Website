import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Stepper, NumberBox, AmountInput } from '../src/app/_components/stepper';

/**
 * The shared compact dialer (Calm-Site-Restyle Decision 1): − [n] +, 32px tall,
 * 16px number. Behaviour under test is the planner's NumberBox contract:
 * clamp on blur/Enter, never mid-typing, never below the box's own minimum.
 */

const setup = (over: Partial<Parameters<typeof Stepper>[0]> = {}) => {
  const onChange = vi.fn();
  render(
    <Stepper
      id="n"
      value={8}
      min={2}
      max={50}
      onChange={onChange}
      groupLabel="People"
      lessLabel="One fewer person"
      moreLabel="One more person"
      {...over}
    />
  );
  return { onChange, box: screen.getByRole('spinbutton') as HTMLInputElement };
};

describe('Stepper', () => {
  it('Person_CanAddOne_WithThePlusButton', async () => {
    const { onChange } = setup();
    await userEvent.setup().click(screen.getByRole('button', { name: 'One more person' }));
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it('Person_CanRemoveOne_WithTheMinusButton', async () => {
    const { onChange } = setup();
    await userEvent.setup().click(screen.getByRole('button', { name: 'One fewer person' }));
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it('MinusButton_IsDisabled_AtTheMinimum', () => {
    setup({ value: 2 });
    expect((screen.getByRole('button', { name: 'One fewer person' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('PlusButton_IsDisabled_AtTheMaximum', () => {
    setup({ value: 50 });
    expect((screen.getByRole('button', { name: 'One more person' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Typing_DoesNotClampOneToTwo_WhileTheyTypeSixteen', async () => {
    const { onChange, box } = setup();
    const user = userEvent.setup();
    await user.clear(box);
    await user.type(box, '1');
    expect(onChange).not.toHaveBeenCalled();
    await user.type(box, '6');
    expect(onChange).toHaveBeenLastCalledWith(16);
  });

  it('Blur_ClampsToTheMinimum', async () => {
    const { onChange, box } = setup();
    const user = userEvent.setup();
    await user.clear(box);
    await user.type(box, '1');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(box.value).toBe('2');
  });

  it('Blur_ClampsToTheMaximum', async () => {
    const { onChange, box } = setup();
    const user = userEvent.setup();
    await user.clear(box);
    await user.type(box, '99');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith(50);
  });

  it('Enter_Commits_WithoutSubmittingTheForm', async () => {
    const submit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onChange = vi.fn();
    render(
      <form onSubmit={submit}>
        <Stepper id="n" value={8} min={2} max={50} onChange={onChange} groupLabel="People" lessLabel="-" moreLabel="+" />
      </form>
    );
    const user = userEvent.setup();
    const box = screen.getByRole('spinbutton');
    await user.clear(box);
    await user.type(box, '12{Enter}');
    expect(submit).not.toHaveBeenCalled();
  });

  it('EmptyBox_RestoresTheValue_OnBlur', async () => {
    const { box } = setup();
    const user = userEvent.setup();
    await user.clear(box);
    await user.tab();
    expect(box.value).toBe('8');
  });

  it('Label_NamesTheInput_AndEndsInAColon', () => {
    setup({ label: 'People' });
    expect(screen.getByRole('spinbutton', { name: 'People:' })).toBeTruthy();
    expect(document.querySelector('label[for="n"]')?.textContent).toBe('People:');
  });

  it('InputLabel_NamesTheInput_WhenThereIsNoVisibleLabel', () => {
    setup({ inputLabel: 'Number of guests' });
    expect(screen.getByRole('spinbutton', { name: 'Number of guests' })).toBeTruthy();
  });

  it('Group_CarriesTheGroupLabel', () => {
    setup();
    expect(screen.getByRole('group', { name: 'People' })).toBeTruthy();
  });

  it('Dialer_IsThirtyTwoPixelsTall_WithASixteenPixelNumber', () => {
    // The CSS is the contract; jsdom can't compute styles, so read the source.
    const css = fs.readFileSync(path.join(__dirname, '../src/app/_components/stepper.module.css'), 'utf8');
    expect(css).toMatch(/height:\s*32px/);
    expect(css).toMatch(/font-size:\s*16px/);
  });
});

describe('NumberBox', () => {
  it('Box_ShowsCents_WhenTheStepIsUnderOne', () => {
    render(<NumberBox id="b" value={4} min={0} max={999} step={0.25} onCommit={() => {}} ariaLabel="Budget" />);
    expect((screen.getByRole('spinbutton', { name: 'Budget' }) as HTMLInputElement).value).toBe('4.00');
  });

  it('Box_DoesNotCommitWhileTyping_WhenItHoldsCents', async () => {
    const onCommit = vi.fn();
    render(<NumberBox id="b" value={4} min={0} max={999} step={0.25} onCommit={onCommit} ariaLabel="Budget" />);
    const user = userEvent.setup();
    const box = screen.getByRole('spinbutton', { name: 'Budget' });
    await user.clear(box);
    await user.type(box, '3.5');
    expect(onCommit).not.toHaveBeenCalled();
    await user.tab();
    expect(onCommit).toHaveBeenCalledWith(3.5);
  });
});

describe('AmountInput', () => {
  it('Amount_KeepsItsNameAndCentsStep_ForTheNativeForm', () => {
    render(<AmountInput name="amount" min="0.01" step="0.01" required aria-label="Amount" />);
    const el = screen.getByRole('spinbutton', { name: 'Amount' }) as HTMLInputElement;
    expect([el.name, el.step, el.min, el.required]).toEqual(['amount', '0.01', '0.01', true]);
  });
});
