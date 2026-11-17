import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/health-forms',
  useSearchParams: () => new URLSearchParams()
}));
vi.mock('../src/lib/shrink-photo', () => ({ shrinkPhoto: async (f: File) => f }));

import { HealthSheet, HealthSheetFooter, type SheetActions } from '../src/app/admin/(workspace)/health-forms/health-sheet';
import { HealthFormsList, type HealthListRow } from '../src/app/admin/(workspace)/health-forms/health-forms-list';
import type { HealthRecordView } from '../src/lib/health-store';
import type { HealthPage } from '../src/lib/health-records';

/**
 * The record sheet (Plans/Admin-Health-Record-Sheet-Redesign.md, version B): the family's note first, contacts with
 * tel: and mailto:, the forms as cards with their own actions, and the review footer with an undo.
 */
afterEach(cleanup);
beforeAll(() => {
  // jsdom has no <dialog> modal API.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
});

const TODAY = '2026-11-16';
const page = (kind: HealthPage['kind'], n: number, over: Partial<HealthPage> = {}): HealthPage => ({
  id: `${kind}-${n}`,
  personId: 7,
  kind,
  page: n,
  contentType: 'image/jpeg',
  uploadedAt: '2026-11-13T15:00:00Z',
  effectiveOn: null,
  expiresOn: null,
  ...over
});
const rec = (over: Partial<HealthRecordView> = {}): HealthRecordView => ({
  personId: 7,
  name: 'Sam Example',
  told: 'Peanut allergy. Carries an EpiPen.',
  contacts: [{ personId: 8, name: 'Dana Example', phone: '(414) 555-0142', email: 'dana@example.test' }],
  pages: [page('bsa_c', 1, { expiresOn: '2027-07-19' }), page('insurance', 1, { expiresOn: '2027-07-19' }), page('insurance', 2, { expiresOn: '2027-07-19' })],
  review: null,
  reviewChange: null,
  inBsaForm: null,
  lastReminder: null,
  lastUpload: '2026-11-13T15:00:00Z',
  ...over
});
const done = (r: HealthRecordView) => vi.fn(async () => ({ ok: true as const, record: r }));
const actions = (r = rec()): SheetActions & Record<keyof SheetActions, ReturnType<typeof vi.fn>> => ({
  upload: done(r),
  saveGoodUntil: done(r),
  remove: done(r),
  setReviewed: done(r),
  setInBsaForm: done(r),
  remind: done(r)
});
const show = (r = rec(), a = actions(r)) => {
  render(<HealthSheet record={r} today={TODAY} actions={a} onRecord={vi.fn()} />);
  return a;
};
const cardFor = (label: string) => screen.getByText(label).closest('li')!;

describe('the left pane', () => {
  it('NamedLeader_SheetShowsFamilyNoteFirst_WhenNotePresent', () => {
    const { container } = render(<HealthSheet record={rec()} today={TODAY} actions={actions()} onRecord={vi.fn()} />);
    const first = container.querySelector('p');
    expect([first?.textContent, screen.getByText('Peanut allergy. Carries an EpiPen.') != null]).toEqual(['From the family', true]);
  });

  it('NamedLeader_SheetHidesFamilyNote_WhenNoNote', () => {
    show(rec({ told: null }));
    expect(screen.queryByText('From the family')).toBeNull();
  });

  it('NamedLeader_ContactsShowTelAndMailto_NoTextLink', () => {
    show();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect([hrefs.includes('tel:4145550142'), hrefs.includes('mailto:dana@example.test'), hrefs.some((h) => h?.startsWith('sms:'))]).toEqual([true, true, false]);
  });
});

describe('the form cards', () => {
  it('NamedLeader_MissingRequiredForm_ShowsEmailReminderAndUploadForFamily', () => {
    show();
    const card = cardFor('BSA health form, Parts A and B');
    expect([
      within(card).getByText('Missing') != null,
      within(card).getByText('No reminder sent yet.') != null,
      within(card).getByRole('button', { name: 'Email reminder' }) != null,
      within(card).getByRole('button', { name: 'Upload for family' }) != null
    ]).toEqual([true, true, true, true]);
  });

  it('EmailReminder_SendsForThisPerson', () => {
    const a = show();
    fireEvent.click(within(cardFor('BSA health form, Parts A and B')).getByRole('button', { name: 'Email reminder' }));
    expect(a.remind).toHaveBeenCalledWith(7);
  });

  it('AfterAReminder_TheCardSaysWhoWasEmailed_AndOffersEmailAgain', () => {
    show(rec({ lastReminder: { at: '2026-11-16T15:00:00Z', byName: 'Pat', to: ['dana@example.test'] } }));
    const card = cardFor('BSA health form, Parts A and B');
    expect([within(card).getByText(/Reminder emailed to Dana Example on Nov 16, 2026/) != null, within(card).getByRole('button', { name: 'Email again' }) != null]).toEqual([true, true]);
  });

  it('UploadForFamily_OpensTheUploadForThatForm', () => {
    show();
    const card = cardFor('BSA health form, Parts A and B');
    fireEvent.click(within(card).getByRole('button', { name: 'Upload for family' }));
    expect([within(card).getByRole('button', { name: '+ Add a photo or PDF' }) != null, within(card).getByText('Good until') != null]).toEqual([true, true]);
  });

  it('ExpiredRequiredForm_StillOffersView', () => {
    show(rec({ pages: [page('bsa_ab', 1, { expiresOn: '2026-01-01' })] }));
    const card = cardFor('BSA health form, Parts A and B');
    expect([within(card).getByText('Expired') != null, within(card).getByRole('link', { name: 'View' }) != null]).toEqual([true, true]);
  });

  it('NoEmailOnFile_SaysCallThem_AndOffersNoEmailButton', () => {
    show(rec({ contacts: [{ personId: 8, name: 'Dana Example', phone: '(414) 555-0142', email: null }] }));
    const card = cardFor('BSA health form, Parts A and B');
    expect([within(card).getByText(/No email on file/) != null, within(card).queryByRole('button', { name: 'Email reminder' })]).toEqual([true, null]);
  });

  it('Change_OpensReplaceAndRemove_ForAFormOnFile', () => {
    show();
    const card = cardFor('BSA health form, Part C');
    fireEvent.click(within(card).getByRole('button', { name: 'Change BSA health form, Part C' }));
    expect([within(card).getByRole('button', { name: /Replace Page 1/ }) != null, within(card).getByRole('button', { name: /Remove Page 1/ }) != null]).toEqual([true, true]);
  });

  it('PartC_OnFile_ShowsGoodUntilAndPages', () => {
    show();
    expect(within(cardFor('BSA health form, Part C')).getByText('1 page · Good until Jul 19, 2027')).toBeTruthy();
  });

  it('PartC_Missing_ReadsGreyMissing_WithNoReminder', () => {
    show(rec({ pages: [] }));
    const card = cardFor('BSA health form, Part C');
    expect([within(card).getByText('Missing') != null, within(card).queryByRole('button', { name: 'Email reminder' })]).toEqual([true, null]);
  });

  it('Insurance_OffersViewFrontAndViewBack', () => {
    show();
    const card = cardFor('Insurance card');
    expect([within(card).getByRole('link', { name: 'View front' }) != null, within(card).getByRole('link', { name: 'View back' }) != null]).toEqual([true, true]);
  });

  it('Immunization_NotNeeded_ReadsNotNeeded_NeverRed', () => {
    show();
    const card = cardFor('Immunization record');
    expect([within(card).getByText('Not needed') != null, within(card).getByText('Not required for this scout.') != null, within(card).queryByText('Missing')]).toEqual([true, true, null]);
  });

  it('Immunization_IncludedInBsaForm_ReadsInBsaForm', () => {
    show(rec({ inBsaForm: { byName: 'Pat', at: '2026-11-16T15:00:00Z' } }));
    expect(within(cardFor('Immunization record')).getByText('In BSA form')).toBeTruthy();
  });

  it('Immunization_LeaderCanSetInBsaForm', () => {
    const a = show();
    fireEvent.click(within(cardFor('Immunization record')).getByRole('button', { name: 'It’s in the BSA form' }));
    expect(a.setInBsaForm).toHaveBeenCalledWith(7, true);
  });

  it('AFailedWrite_ShowsTheProblemOnItsCard', async () => {
    const a = actions();
    a.remind.mockResolvedValueOnce({ ok: false, error: 'The email didn’t go. Try again in a minute.' });
    show(rec(), a);
    const card = cardFor('BSA health form, Parts A and B');
    fireEvent.click(within(card).getByRole('button', { name: 'Email reminder' }));
    await waitFor(() => expect(within(card).getByRole('alert').textContent).toMatch(/didn’t go/));
  });
});

describe('the footer', () => {
  const foot = (r: HealthRecordView, a = actions(r), onClose = vi.fn()) => {
    render(<HealthSheetFooter record={r} actions={a} onRecord={vi.fn()} onClose={onClose} />);
    return { a, onClose };
  };

  it('NotReviewed_OffersMarkReviewed', () => {
    const { a } = foot(rec());
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    expect([screen.getByText('Not reviewed') != null, a.setReviewed.mock.calls[0]]).toEqual([true, [7, true]]);
  });

  it('Reviewed_ShowsWhoAndWhen_AndOffersUndo', () => {
    const { a } = foot(rec({ review: { personId: 7, byName: 'Pat Leader', at: '2026-11-16T15:00:00Z' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo review' }));
    expect([screen.getByText('by Pat Leader on Nov 16, 2026') != null, a.setReviewed.mock.calls[0]]).toEqual([true, [7, false]]);
  });

  it('AfterUndo_SaysWhoUndidIt', () => {
    foot(rec({ reviewChange: { action: 'unreview', byName: 'Pat Leader', at: '2026-11-16T15:00:00Z' }, lastUpload: '2026-11-13T15:00:00Z' }));
    expect(screen.getByText('Review undone by Pat Leader on Nov 16, 2026')).toBeTruthy();
  });

  it('AnUploadAfterTheUndo_ReadsPlainNotReviewed', () => {
    foot(rec({ reviewChange: { action: 'unreview', byName: 'Pat Leader', at: '2026-11-14T15:00:00Z' }, lastUpload: '2026-11-15T15:00:00Z' }));
    expect(screen.queryByText(/Review undone/)).toBeNull();
  });

  it('FooterClose_Closes', () => {
    const { onClose } = foot(rec());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('in the list', () => {
  const row: HealthListRow = {
    personId: 7,
    name: 'Sam Example',
    firstName: 'Sam',
    lastName: 'Example',
    type: 'scout',
    lastUpload: '2026-11-13T15:00:00Z',
    marks: {
      bsa_ab: { text: 'Missing', tone: 'bad', srText: 'missing', rank: 0 },
      bsa_c: { text: '✓', tone: 'ok', srText: 'on file', rank: 3 },
      insurance: { text: '✓', tone: 'ok', srText: 'on file', rank: 3 },
      immunization: { text: '—', tone: 'none', srText: 'not on file', rank: 4 }
    },
    standing: 'missing',
    standingRank: 0
  };

  it('Sheet_FooterCloseAndX_ReturnFocusToOpener', async () => {
    const r = rec();
    render(<HealthFormsList rows={[row]} initialPersonId={null} lede="Lede" today={TODAY} openRecord={async () => ({ ok: true, record: r })} actions={actions(r)} />);
    const view = screen.getByRole('button', { name: 'View Sam Example' });
    for (const name of ['Close', '✕']) {
      view.focus();
      fireEvent.click(view);
      await screen.findByText('Forms on file');
      // Both are named "Close": the footer's by its text, the header's ✕ by its aria-label.
      const btn = screen.getAllByRole('button', { name: 'Close' });
      fireEvent.click(btn.find((b) => b.textContent === name)!);
      await waitFor(() => expect(document.activeElement).toBe(view));
    }
  });

  it('Sheet_HasNoPrevOrNext', async () => {
    const r = rec();
    render(<HealthFormsList rows={[row]} initialPersonId={null} lede="Lede" today={TODAY} openRecord={async () => ({ ok: true, record: r })} actions={actions(r)} />);
    fireEvent.click(screen.getByRole('button', { name: 'View Sam Example' }));
    await screen.findByText('Forms on file');
    expect([screen.queryByRole('button', { name: /Prev/ }), screen.queryByRole('button', { name: /Next/ })]).toEqual([null, null]);
  });
});
