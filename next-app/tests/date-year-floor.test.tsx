import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { parseTypedDate, isValidISODate, typedDateTooEarly, TOO_EARLY_MSG } from '../src/lib/date-entry';
import { DatePickerField } from '../src/app/admin/(workspace)/_components/date-picker-field';
import { DateField } from '../src/app/_components/date-field';

/**
 * No date before 1900 (Patrick, 2026-11-01): Oliver Vest's Communication MB went in as year 0025 and a birthdate as
 * 0991. Every typed date field refuses the year and says so on the field; the database refuses it too
 * (date-floor-db.test.ts).
 */
describe('date-entry: the 1900 floor', () => {
  it('ParseTypedDate_RefusesAYearBefore1900', () => {
    expect(parseTypedDate('0991-09-25')).toBeNull();
  });

  it('ParseTypedDate_Refuses1899', () => {
    expect(parseTypedDate('12/31/1899')).toBeNull();
  });

  it('ParseTypedDate_Accepts1900', () => {
    expect(parseTypedDate('1900-01-01')).toBe('1900-01-01');
  });

  it('IsValidISODate_RefusesAYearBefore1900', () => {
    expect(isValidISODate('0025-11-08')).toBe(false);
  });

  it('TypedDateTooEarly_IsTrue_ForARealDayBefore1900', () => {
    expect(typedDateTooEarly('0025-11-08')).toBe(true);
  });

  it('TypedDateTooEarly_IsFalse_ForAnOrdinaryDate', () => {
    expect(typedDateTooEarly('11/8/2025')).toBe(false);
  });

  it('TypedDateTooEarly_IsFalse_ForGibberish', () => {
    expect(typedDateTooEarly('next week')).toBe(false);
  });
});

describe('admin DatePickerField: the 1900 floor', () => {
  const typeAndBlur = (text: string) => {
    const onChange = vi.fn();
    render(<DatePickerField value="" onChange={onChange} id="d" />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: text } });
    fireEvent.blur(input);
    return onChange;
  };

  it('AYearBefore1900_IsNotSaved', () => {
    expect(typeAndBlur('0025-11-08')).not.toHaveBeenCalled();
  });

  it('AYearBefore1900_SaysWhyOnTheField', () => {
    typeAndBlur('9/25/991');
    expect(screen.getByText(TOO_EARLY_MSG)).toBeTruthy();
  });

  it('AnOrdinaryDate_StillSaves', () => {
    expect(typeAndBlur('11/8/2025')).toHaveBeenCalledWith('2025-11-08');
  });
});

describe('public DateField: the 1900 floor', () => {
  it('AYearBefore1900_SaysWhyOnTheField', () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '0991-09-25' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(TOO_EARLY_MSG)).toBeTruthy();
  });
});
