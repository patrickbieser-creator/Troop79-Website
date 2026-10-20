import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BsaRosterView } from '../src/app/admin/(workspace)/advancement/bsa-roster/bsa-roster-view';
import type { RosterCheckResult } from '../src/app/admin/(workspace)/advancement/bsa-roster/actions';
import type { StoredRegistration } from '../src/lib/bsa-roster-db';

/**
 * BSA Roster screen. Server actions are vi.fn()s; the component is what's
 * under test. Found in the browser 2026-10-20: a form action resets the form,
 * so Save re-read an emptied file input and sent no file.
 */
const checked: RosterCheckResult = {
  ok: true,
  report: {
    asOf: '2026-10-20',
    matched: [{ memberId: '900002', personId: 2, via: 'bsa' }],
    unmatched: [],
    differences: [],
    inactiveButRegistered: [],
    notOnRoster: [],
    registrations: [
      { personId: 2, expires: '2026-12-31', status: 'Multiple', positions: ['Scoutmaster'], autoRenewOptedOut: false, asOf: '2026-10-20' }
    ]
  }
};

function setup(registrations: StoredRegistration[] = []) {
  const checkAction = vi.fn(async () => checked);
  const saveAction = vi.fn(async () => ({ ok: true as const, saved: 1 }));
  render(<BsaRosterView registrations={registrations} today="2026-10-20" checkAction={checkAction} saveAction={saveAction} />);
  return { checkAction, saveAction };
}

async function checkFile() {
  const user = userEvent.setup();
  const file = new File(['memberid'], 'Roster_Report.csv', { type: 'text/csv' });
  await user.upload(screen.getByLabelText('BSA Roster Report CSV'), file);
  await user.click(screen.getByRole('button', { name: 'Check roster' }));
  return { user, file };
}

describe('BsaRosterView', () => {
  it('Leader_SavesRegistrationDates_FromTheFileTheyChecked', async () => {
    const { saveAction } = setup();
    const { user, file } = await checkFile();
    await user.click(await screen.findByRole('button', { name: 'Save registration dates (1)' }));
    expect((saveAction.mock.calls[0] as unknown as [FormData])[0].get('file')).toEqual(file);
  });

  it('Leader_SeesSaved_AfterSaving', async () => {
    setup();
    const { user } = await checkFile();
    await user.click(await screen.findByRole('button', { name: 'Save registration dates (1)' }));
    expect(await screen.findByText('Saved for 1 person.')).toBeTruthy();
  });

  it('Leader_SeesAnExpiredRegistration_Flagged', () => {
    setup([{ personId: 5, name: 'Xavier Test', expires: '2026-08-31', status: 'Re-Registered', positions: ['Youth Member'], autoRenewOptedOut: false, asOf: '2026-10-20' }]);
    expect(screen.getByText('Expired')).toBeTruthy();
  });
});
