import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HealthForms, type HealthActions } from '../src/app/(public)/member/health-forms/health-forms';
import type { HealthKind, HealthPage } from '../src/lib/health-records';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../src/app/(public)/member/health-forms/shrink-photo', () => ({ shrinkPhoto: async (f: File) => f }));

/** The parent's health-forms screen (Plans/Health-Forms.md, release 1). */
const TODAY = '2026-11-13';
const people = [{ personId: 1, name: 'Ben Example', isScout: true }];
let n = 0;
const page = (kind: HealthKind, p: number, over: Partial<HealthPage> = {}): HealthPage => ({
  id: `00000000-0000-4000-8000-00000000000${(n += 1)}`,
  personId: 1,
  kind,
  page: p,
  contentType: 'image/jpeg',
  uploadedAt: '2026-11-01T18:00:00Z',
  effectiveOn: null,
  expiresOn: null,
  ...over
});
const actions = (): HealthActions & { upload: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; saveDates: ReturnType<typeof vi.fn> } => ({
  upload: vi.fn(async () => ({ ok: true as const })),
  saveDates: vi.fn(async () => ({ ok: true as const })),
  remove: vi.fn(async () => ({ ok: true as const }))
});
const show = (pages: HealthPage[], a = actions()) => {
  render(<HealthForms people={people} pages={pages} today={TODAY} actions={a} />);
  return a;
};
const card = () => screen.getByRole('region', { name: 'Ben Example' });

describe('HealthForms', () => {
  it('Parent_WithNothingOnFile_SeesWhatIsMissing', () => {
    show([]);
    expect(within(card()).getByText('Something missing')).toBeTruthy();
  });

  it('Parent_WithTheFormAndBothCardSides_SeesOnFile', () => {
    show([page('bsa_ab', 1), page('insurance', 1), page('insurance', 2)]);
    expect(within(card()).queryByText('Something missing')).toBeNull();
  });

  it('Parent_SeesPartC_AsNotNeeded_UntilTheyAddIt', () => {
    show([]);
    expect(within(card()).getAllByText('Not needed for most outings').length).toBe(2);
  });

  it('Parent_SeesWhenTheFormRunsOut', () => {
    show([page('bsa_ab', 1, { expiresOn: '2027-03-04' })]);
    expect(within(card()).getByText(/Good until Mar 4, 2027/)).toBeTruthy();
  });

  it('Parent_CanViewAPage_ThroughTheSiteOnly', () => {
    const p = page('bsa_ab', 1);
    show([p]);
    expect(within(card()).getByRole('link', { name: 'View' }).getAttribute('href')).toBe(`/api/health-files/${p.id}`);
  });

  it('Parent_IsOfferedFrontAndBack_ForTheInsuranceCard', () => {
    show([page('insurance', 1)]);
    expect([screen.queryByRole('button', { name: /Add the front of the insurance card/ }), screen.getByRole('button', { name: /Add the back of the insurance card/ }) != null]).toEqual([null, true]);
  });

  it('Parent_ChoosingAFile_UploadsItToThatPersonDocumentAndPage', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const a = show([page('bsa_ab', 1)]);
    await user.click(screen.getByRole('button', { name: 'Add a page to BSA health form, Parts A and B for Ben Example' }));
    const input = card().querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array([0xff, 0xd8, 0xff])], 'p.jpg', { type: 'image/jpeg' }));
    const fd = a.upload.mock.calls[0][0] as FormData;
    expect([fd.get('personId'), fd.get('kind'), fd.get('page'), fd.get('file') instanceof File]).toEqual(['1', 'bsa_ab', '2', true]);
  });

  it('Parent_RemovingAPage_IsAskedFirst', async () => {
    const user = userEvent.setup();
    const p = page('bsa_ab', 1);
    const a = show([p]);
    await user.click(screen.getByRole('button', { name: /Remove Page 1 of BSA health form, Parts A and B/ }));
    expect([a.remove.mock.calls.length, screen.getByText(/deleted for good/) != null]).toEqual([0, true]);
  });

  it('Parent_ConfirmingRemove_DeletesThatPage', async () => {
    const user = userEvent.setup();
    const p = page('bsa_ab', 1);
    const a = show([p]);
    await user.click(screen.getByRole('button', { name: /Remove Page 1 of BSA health form, Parts A and B/ }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(a.remove.mock.calls[0][0]).toBe(p.id);
  });

  it('Parent_SeesTheProblem_WhenAnUploadIsRefused', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const a = actions();
    a.upload.mockResolvedValueOnce({ ok: false, error: 'That file is too big.' });
    show([], a);
    await user.click(screen.getByRole('button', { name: 'Add a page to BSA health form, Parts A and B for Ben Example' }));
    await user.upload(card().querySelectorAll('input[type="file"]')[0] as HTMLInputElement, new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That file is too big.');
  });
});
