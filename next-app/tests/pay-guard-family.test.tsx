import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PayFrom, factsFrom, needsAccountPick, wouldGoNegative, type AccountFacts } from '../src/app/admin/(workspace)/events/pay-guard';

/**
 * Record payment → "Scout account balance" can draw on a family member's
 * account (Patrick, 2026-10-05). The picker appears only when the family has
 * an account to offer; the negative-balance guard then reads the CHOSEN
 * account, not the attendee's.
 */
const dad: AccountFacts = {
  entryId: 7,
  balance: 0,
  scholarshipBalance: 200,
  family: [{ personId: 31, name: 'Winnie Black', balance: 85 }]
};

describe('factsFrom', () => {
  it('FactsFrom_ReadsTheChosenFamilyAccount_SoTheGuardChecksTheRightBalance', () => {
    expect(wouldGoNegative('scout_account', factsFrom(dad, null), 30)).toBe(true);
    expect(wouldGoNegative('scout_account', factsFrom(dad, 31), 30)).toBe(false);
  });

  it('FactsFrom_KeepsTheAttendeesOwnBalance_WhenThePersonIsNotInTheFamily', () => {
    expect(factsFrom(dad, 999)?.balance).toBe(0);
  });
});

describe('needsAccountPick', () => {
  it('NeedsAccountPick_HoldsRecordOff_UntilAGuestsFamilyAccountIsChosen', () => {
    const guest = { ...dad, balance: null };
    expect(needsAccountPick('scout_account', guest, null)).toBe(true);
    expect(needsAccountPick('scout_account', guest, 31)).toBe(false);
    expect(needsAccountPick('scout_account', dad, null)).toBe(false);
    expect(needsAccountPick('venmo', guest, null)).toBe(false);
  });
});

describe('PayFrom', () => {
  it('PayFrom_OffersTheAttendeeAndEachFamilyAccount_WithBalances', () => {
    render(<PayFrom method="scout_account" facts={dad} selfName="Michael Black" value={null} onChange={() => {}} />);
    const picker = screen.getByRole('combobox', { name: 'Whose account' });
    expect(picker).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Michael Black — $0' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Winnie Black — $85' })).toBeTruthy();
  });

  it('PayFrom_ReportsTheFamilyMemberPicked', async () => {
    const onChange = vi.fn();
    render(<PayFrom method="scout_account" facts={dad} selfName="Michael Black" value={null} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Whose account' }), 'Winnie Black — $85');
    expect(onChange).toHaveBeenCalledWith(31);
  });

  it('PayFrom_IsAbsent_WhenNobodyElseInTheFamilyHasAnAccount', () => {
    render(<PayFrom method="scout_account" facts={{ ...dad, family: [] }} selfName="Michael Black" value={null} onChange={() => {}} />);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('PayFrom_IsAbsent_ForACashMethod', () => {
    render(<PayFrom method="venmo" facts={dad} selfName="Michael Black" value={null} onChange={() => {}} />);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('PayFrom_MakesAGuestChoose_SinceAGuestHasNoAccountOfTheirOwn', () => {
    render(<PayFrom method="scout_account" facts={{ ...dad, balance: null }} selfName="Cousin Sam" value={null} onChange={() => {}} />);
    expect(screen.queryByRole('option', { name: /Cousin Sam/ })).toBeNull();
    expect(screen.getByRole('option', { name: 'Choose a family member…' })).toBeTruthy();
  });
});
