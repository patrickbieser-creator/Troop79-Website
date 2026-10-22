import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { PlanRow } from '../src/lib/build-plan';

/**
 * Build a Plan B3 (Plans/Build-A-Plan.md "Invite…"), the screen: the one primary Invite… for editors (greyed with the
 * reason for a scout editor), the rail's "N invited", and a sheet whose button counts digest emails (one per
 * recipient, a parent with two scouts counted once). Server actions are mocked; their rules are in
 * build-plan-invite-db.test.ts.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const m = vi.hoisted(() => ({ sheet: vi.fn(), send: vi.fn() }));
vi.mock('../src/app/(public)/planner/build-actions', () => ({
  plannerAddOfferingAction: vi.fn(),
  plannerRemoveOfferingAction: vi.fn(),
  plannerAddFocusSetAction: vi.fn(),
  plannerNewMixAction: vi.fn(),
  plannerEditMixAction: vi.fn(),
  plannerMixAction: vi.fn(),
  plannerSetTeacherAction: vi.fn(),
  plannerTeacherChoicesAction: vi.fn(),
  plannerBuildStampAction: vi.fn(async () => ({ ok: false })),
  plannerInviteSheetAction: m.sheet,
  plannerSendInvitesAction: m.send
}));
vi.mock('../src/app/(public)/planner/focus-actions', () => ({ focusSearchAction: vi.fn(), focusSetsAction: vi.fn(async () => ({ ok: true, sets: [] })) }));
vi.mock('../src/app/(public)/planner/actions', () => ({ plannerStampAction: vi.fn(async () => ({ ok: false })) }));

const { BuildPlanView } = await import('../src/app/(public)/planner/build/build-client');

const ROWS: PlanRow[] = [{ key: 'tenderfoot-4a', codeLabel: 'Tenderfoot 4a', title: 'First aid', origin: 'planner', seeded: true, teachers: [], scouts: 0, canTeach: 2, state: 'needs-teacher' }];
const person = (personId: number, recipients: number[], o: { likely?: boolean; blocked?: string } = {}) => ({ personId, name: `P${personId}`, reason: 'r', likely: o.likely ?? true, recipients, blocked: o.blocked ?? null });

afterEach(() => {
  cleanup();
  m.sheet.mockReset();
  m.send.mockReset();
});

describe('Invite…', () => {
  it('Invite_ScoutEditor_SeesItGreyedWithTheReason', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed={false} canEdit stamp="s" heading={null} />);
    expect([(screen.getByRole('button', { name: 'Invite…' }) as HTMLButtonElement).disabled, screen.queryByText('Only adults send email') != null]).toEqual([true, true]);
  });

  it('Invite_Rail_SaysHowManyInvited', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed={false} canEdit canEmail invited={6} stamp="s" heading={null} />);
    expect(screen.getByText(/6 invited/)).toBeTruthy();
  });

  it('Invite_SheetButton_CountsOneEmailPerRecipient', async () => {
    // A teacher (themself), two scouts of one parent (40), one scout 13+ (40 and 12), one blocked scout, one "other".
    m.sheet.mockResolvedValue({
      ok: true,
      sections: [{ key: 'tenderfoot-4a', teachers: [person(30, [30])], scouts: [person(10, [40]), person(11, [40]), person(12, [40, 12]), person(13, [50], { blocked: 'no parent with an email' }), person(14, [60], { likely: false })] }]
    });
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed={false} canEdit canEmail stamp="s" heading={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite…' }));
    expect(await screen.findByRole('button', { name: 'Send 3 emails' })).toBeTruthy();
  });
});

describe('the sheet announces itself (qa-lead B3 #2)', () => {
  const openSheet = () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed={false} canEdit canEmail stamp="s" heading={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite…' }));
    return within(screen.getByRole('dialog'));
  };

  it('InviteSheet_Loading_IsAnnouncedInALiveRegion', () => {
    m.sheet.mockReturnValue(new Promise(() => undefined));
    expect(openSheet().getByRole('status').textContent).toBe('Finding who to invite…');
  });

  it('InviteSheet_AfterSend_AnnouncesInTheSameLiveRegion', async () => {
    m.sheet.mockResolvedValue({ ok: true, sections: [{ key: 'tenderfoot-4a', teachers: [person(30, [30])], scouts: [] }] });
    m.send.mockResolvedValue({ ok: true, sent: ['P30'], emails: 1, skipped: [], invited: 1, prior: 's', stamp: 's2' });
    const sheet = openSheet();
    const status = sheet.getByRole('status');
    fireEvent.click(await sheet.findByRole('button', { name: 'Send 1 email' }));
    await waitFor(() => expect(status.textContent).toBe('Sent 1 email.'));
  });

  it('InviteSheet_AfterSend_FocusesTheSummary', async () => {
    m.sheet.mockResolvedValue({ ok: true, sections: [{ key: 'tenderfoot-4a', teachers: [person(30, [30])], scouts: [] }] });
    m.send.mockResolvedValue({ ok: true, sent: ['P30'], emails: 1, skipped: [], invited: 1, prior: 's', stamp: 's2' });
    const sheet = openSheet();
    fireEvent.click(await sheet.findByRole('button', { name: 'Send 1 email' }));
    await waitFor(() => expect([document.activeElement !== document.body, document.activeElement?.textContent?.includes('Invited P30.')]).toEqual([true, true]));
  });
});
