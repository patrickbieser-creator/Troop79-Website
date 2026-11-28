import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DatePickerField } from '../src/app/admin/(workspace)/_components/date-picker-field';
import { toISODate } from '../src/lib/date-entry';

/**
 * The admin picker reads typed text with the same grammar as the public DateField (lib/date-entry), never
 * Date.parse (Patrick, 2026-11-27): Chrome's Date.parse rolls '2/30/2026' into March 2 and refuses the
 * forms families and leaders actually type ('20260725', 'today', '7/25').
 */
function typeAndBlur(text: string) {
  const onChange = vi.fn();
  render(<DatePickerField value="" onChange={onChange} id="d" />);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
  return onChange;
}

describe('admin DatePickerField: shared typed-date grammar', () => {
  it('AnImpossibleDay_IsNotRolledIntoTheNextMonth', () => {
    expect(typeAndBlur('2/30/2026')).not.toHaveBeenCalled();
  });

  it('AnImpossibleDay_SaysItIsUnrecognized', () => {
    typeAndBlur('2/30/2026');
    expect(screen.getByRole('combobox').getAttribute('aria-invalid')).toBe('true');
  });

  it('AnUnrecognizedDate_SuggestsTheFormsPeopleType', () => {
    typeAndBlur('next week');
    expect(screen.getByText('Unrecognized date — try 7/25/2026 or Jul 25, 2026')).toBeTruthy();
  });

  it('ABareDigitRun_Saves', () => {
    expect(typeAndBlur('20260725')).toHaveBeenCalledWith('2026-07-25');
  });

  it('ATwoDigitYear_Saves', () => {
    expect(typeAndBlur('7-25-26')).toHaveBeenCalledWith('2026-07-25');
  });

  it('AMonthNameDayFirst_Saves', () => {
    expect(typeAndBlur('25th July 2026')).toHaveBeenCalledWith('2026-07-25');
  });

  it('MonthAndDayOnly_SavesInTheCurrentYear', () => {
    expect(typeAndBlur('7/25')).toHaveBeenCalledWith(`${new Date().getFullYear()}-07-25`);
  });

  it('Today_Saves', () => {
    expect(typeAndBlur('today')).toHaveBeenCalledWith(toISODate(new Date()));
  });
});

/** Props the bare <input type="date"> sites relied on (Finance, Menu Monster prices, the event Money tab). */
describe('admin DatePickerField: replaces the browser date box', () => {
  it('Required_MarksTheVisibleInputRequired', () => {
    render(<DatePickerField value="" onChange={() => {}} required />);
    expect((screen.getByRole('combobox') as HTMLInputElement).required).toBe(true);
  });

  it('AriaLabel_NamesTheField', () => {
    render(<DatePickerField value="" onChange={() => {}} aria-label="Expense date" />);
    expect(screen.getByRole('combobox', { name: 'Expense date' })).toBeTruthy();
  });

  it('ADateAfterMax_IsNotSaved', () => {
    const onChange = vi.fn();
    render(<DatePickerField value="" onChange={onChange} max="2026-11-27" />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '11/28/2026' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ADateAfterMax_SaysTheLatestAllowed', () => {
    render(<DatePickerField value="" onChange={() => {}} max="2026-11-27" />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '11/28/2026' } });
    fireEvent.blur(input);
    expect(screen.getByText('The date must be Nov 27, 2026 or earlier')).toBeTruthy();
  });

  it('MaxItself_Saves', () => {
    const onChange = vi.fn();
    render(<DatePickerField value="" onChange={onChange} max="2026-11-27" />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '11/27/2026' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('2026-11-27');
  });
});

/** The error sits inside whatever <label> wraps the field; it must describe the field, not rename it. */
describe('admin DatePickerField: the error inside a wrapping label', () => {
  const showError = () => {
    render(
      <label>
        Date
        <DatePickerField value="" onChange={() => {}} />
      </label>
    );
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'next week' } });
    fireEvent.blur(input);
  };

  it('TheFieldKeepsItsLabelAsItsName', () => {
    showError();
    expect(screen.getByRole('combobox', { name: 'Date' })).toBeTruthy();
  });

  it('TheErrorDescribesTheField', () => {
    showError();
    expect(screen.getByRole('combobox', { description: /Unrecognized date/ })).toBeTruthy();
  });
});

/** Chrome folds a button inside the wrapping <label> into the field's name ("Date Open calendar"), so the icon is a
 *  mouse shortcut only; the field itself opens the calendar on click or ArrowDown. */
describe('admin DatePickerField: the calendar icon', () => {
  it('IsNotASeparateControlForAssistiveTech', () => {
    render(<DatePickerField value="" onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Open calendar' })).toBeNull();
  });

  it('IsNotATabStop', () => {
    const { container } = render(<DatePickerField value="" onChange={() => {}} />);
    expect(container.querySelector('button')?.tabIndex).toBe(-1);
  });

  it('ArrowDownOnTheField_OpensTheCalendar', () => {
    render(<DatePickerField value="" onChange={() => {}} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    expect(screen.getByRole('combobox').getAttribute('aria-expanded')).toBe('true');
  });
});
