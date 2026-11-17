import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/health-forms',
  useSearchParams: () => new URLSearchParams()
}));

import { HealthFormsList, type HealthListRow } from '../src/app/admin/(workspace)/health-forms/health-forms-list';
import type { HealthMarkValue } from '../src/lib/health-marks';
import type { SheetActions } from '../src/app/admin/(workspace)/health-forms/health-sheet';

/**
 * Admin Health Forms list (Plans/Admin-Health-Forms.md, phase 2): default sort, the status tabs that carry the
 * totals, the Type switch, and the sheet opening through the logging action.
 */
afterEach(cleanup);

const ok: HealthMarkValue = { text: '✓', tone: 'ok', srText: 'on file', rank: 3 };
const missing: HealthMarkValue = { text: 'Missing', tone: 'bad', srText: 'missing', rank: 0 };
const dash: HealthMarkValue = { text: '—', tone: 'none', srText: 'not on file', rank: 4 };

const row = (personId: number, name: string, type: HealthListRow['type'], standing: HealthListRow['standing']): HealthListRow => ({
  personId,
  name,
  firstName: name.split(' ')[0],
  lastName: name.split(' ')[1],
  type,
  lastUpload: null,
  marks: { bsa_ab: standing === 'missing' ? missing : ok, bsa_c: dash, insurance: ok, immunization: dash },
  standing,
  standingRank: standing === 'missing' ? 0 : 4
});

const rows = [row(3, 'Cara Zed', 'adult', 'complete'), row(1, 'Ava Chen', 'scout', 'missing'), row(2, 'Ben Adams', 'scout', 'complete')];
const names = () => screen.getAllByRole('link', { name: /^(Ava Chen|Ben Adams|Cara Zed)$/ }).map((a) => a.textContent);

function setup(openRecord = vi.fn(async () => ({ ok: false as const, error: 'no' }))) {
  render(<HealthFormsList rows={rows} initialPersonId={null} lede="Lede" today="2026-11-15" openRecord={openRecord} actions={{} as SheetActions} />);
  return openRecord;
}

describe('HealthFormsList', () => {
  it('HealthList_DefaultSort_IsNameAscending', () => {
    setup();
    expect(names()).toEqual(['Ava Chen', 'Ben Adams', 'Cara Zed']);
  });

  it('HealthList_TabsCarryTheTotals', () => {
    setup();
    const tabs = screen.getByRole('tablist', { name: 'Health status' });
    expect([within(tabs).getByText('All').closest('[role=tab]')?.textContent, within(tabs).getByText('Missing or expired').closest('[role=tab]')?.textContent]).toEqual(['All (3)', 'Missing or expired (1)']);
  });

  it('HealthList_MissingTab_ShowsOnlyThoseNeedingAFile', () => {
    setup();
    fireEvent.click(screen.getByText('Missing or expired'));
    expect(names()).toEqual(['Ava Chen']);
  });

  it('HealthList_TypeSwitch_NarrowsToAdults', () => {
    setup();
    fireEvent.click(screen.getByLabelText('Adults'));
    expect(names()).toEqual(['Cara Zed']);
  });

  it('HealthList_View_OpensTheRecordThroughTheLoggingAction', () => {
    const open = setup();
    fireEvent.click(screen.getAllByRole('button', { name: /^View/ })[0]);
    expect(open).toHaveBeenCalledWith(1);
  });
});
