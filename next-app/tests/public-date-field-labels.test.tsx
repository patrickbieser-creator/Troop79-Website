import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DateField } from '../src/app/_components/date-field';

/**
 * The public DateField inside a wrapping <label> (Health Forms "Good until", the planner's saved-plan Date)
 * (Patrick, 2026-11-27, matching the admin picker): Chrome folded the icon button's "Open calendar" and the error
 * note into the field's name. The label names the field, the note describes it, and the note is still announced.
 */
function showError() {
  render(
    <label>
      Date
      <DateField value="" onChange={() => {}} />
    </label>
  );
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'next week' } });
  fireEvent.blur(input);
}

describe('public DateField inside a wrapping label', () => {
  it('TheFieldKeepsItsLabelAsItsName', () => {
    showError();
    expect(screen.getByRole('combobox', { name: 'Date' })).toBeTruthy();
  });

  it('TheErrorDescribesTheField', () => {
    showError();
    expect(screen.getByRole('combobox', { description: /Unrecognized date/ })).toBeTruthy();
  });

  it('TheErrorIsStillAnnounced', () => {
    showError();
    expect(screen.getByRole('alert').textContent).toMatch(/Unrecognized date/);
  });

  it('TheAnnouncementSitsOutsideTheLabel', () => {
    showError();
    expect(screen.getByRole('alert').closest('label')).toBeNull();
  });
});

describe('public DateField: the calendar icon', () => {
  it('IsNotASeparateControlForAssistiveTech', () => {
    render(<DateField value="" onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Open calendar' })).toBeNull();
  });

  it('IsNotATabStop', () => {
    const { container } = render(<DateField value="" onChange={() => {}} />);
    expect(container.querySelector('button')?.tabIndex).toBe(-1);
  });
});
