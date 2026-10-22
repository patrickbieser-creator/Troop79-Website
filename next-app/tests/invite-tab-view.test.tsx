import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { PlanRow } from '../src/lib/build-plan';
import type { InvitePerson, InviteTabData } from '../src/lib/meeting-invite-digest';

/**
 * Build a Plan B6 (Plans/Build-A-Plan.md "B6: Invite tab"), the screen: the tab's place, the offering detail (likely
 * scouts, the rest behind "Show all eligible"), the not-ready warning that doesn't block, the empty plan, read-only for
 * viewers and the SPL, the one primary counting emails and families, Preview through the real digest renderer, and
 * what moved out of Build (Invite in the row's ⋯, "Next: Invite →" as Build's primary). Server actions are mocked;
 * their rules are in build-plan-invite-db.test.ts.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
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
const digest = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../src/lib/meeting-invite-email', async (orig) => {
  const real = await orig<typeof import('../src/lib/meeting-invite-email')>();
  return {
    ...real,
    renderInviteDigest: (...args: Parameters<typeof real.renderInviteDigest>) => {
      digest.calls++;
      return real.renderInviteDigest(...args);
    }
  };
});

const { InviteView } = await import('../src/app/(public)/planner/invite/invite-client');
const { BuildPlanView } = await import('../src/app/(public)/planner/build/build-client');
const { PlannerTabs } = await import('../src/app/(public)/planner/planner-tabs');
const { DEFAULT_INVITE_DIGEST } = await import('../src/lib/meeting-invite-email');

const ROW: PlanRow = { key: 'tenderfoot-4a', codeLabel: 'Tenderfoot 4a', title: 'First aid', origin: 'planner', seeded: true, teachers: [], scouts: 0, canTeach: 2, state: 'needs-teacher' };
const READY: PlanRow = { ...ROW, key: 'scout-1a', codeLabel: 'Scout 1a', title: 'Oath', teachers: ['Maria L'], scouts: 2, state: 'ready' };
const person = (personId: number, recipients: number[], o: Partial<InvitePerson> = {}): InvitePerson => ({ personId, name: `P${personId}`, reason: 'r', likely: true, recipients, blocked: null, ...o });
const RECIPIENTS: InviteTabData['recipients'] = {
  30: { name: 'Teach T', first: 'Teach', family: 'h:3', familyLabel: 'Teacher family', isScout: false },
  40: { name: 'Dana W', first: 'Dana', family: 'h:4', familyLabel: 'Walters family', isScout: false },
  12: { name: 'P12', first: 'P12', family: 'h:4', familyLabel: 'Walters family', isScout: true }
};
// A teacher (themself), two scouts of one parent (40), one scout 13+ (40 and 12): 3 emails to 2 families.
const DATA: InviteTabData = {
  sections: [{ key: 'tenderfoot-4a', teachers: [person(30, [30], { tier: 'top' })], scouts: [person(10, [40]), person(11, [40]), person(12, [40, 12]), person(14, [60], { likely: false })] }],
  recipients: RECIPIENTS
};

function renderTab(o: Partial<Parameters<typeof InviteView>[0]> = {}) {
  return render(
    <InviteView entryId={1} rows={[ROW]} data={DATA} canEmail readOnly={null} buildHref="/planner/build?meeting=1" initialKey="tenderfoot-4a" template={DEFAULT_INVITE_DIGEST} day="Sunday, October 25, 2026" heading={null} {...o} />
  );
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
});
afterEach(() => {
  cleanup();
  m.sheet.mockReset();
  m.send.mockReset();
  digest.calls = 0;
});

describe('the Invite tab', () => {
  it('InviteTab_IsBetweenBuildAndWhosComing', () => {
    render(<PlannerTabs active="invite" />);
    expect(screen.getAllByRole('tab').map((a) => a.textContent)).toEqual(['Build a Plan', 'Invite', 'Who’s coming', 'Meeting Live', 'Focus sets', 'Has/Needs']);
  });

  it('InviteTab_ShowAllEligible_ExpandsRest', () => {
    renderTab();
    const before = screen.queryByText('P14');
    fireEvent.click(screen.getByRole('button', { name: 'Show all eligible (1)' }));
    expect([before, screen.getByText('P14').closest('button')?.getAttribute('aria-pressed')]).toEqual([null, 'false']);
  });

  it('InviteTab_NotReady_Warns_DoesNotBlock', () => {
    renderTab();
    const warned = screen.getByText(/No teacher yet: Tenderfoot 4a/) != null;
    expect([warned, (screen.getByRole('button', { name: /^Send \d+ emails? to/ }) as HTMLButtonElement).disabled]).toEqual([true, false]);
  });

  it('InviteTab_EmptyPlan_LinksToBuild', () => {
    renderTab({ rows: [], data: { sections: [], recipients: {} } });
    expect(screen.getByRole('link', { name: 'Build a Plan' }).getAttribute('href')).toBe('/planner/build?meeting=1');
  });

  it('InviteTab_Viewer_And_SPL_SendIsDisabled', () => {
    renderTab({ canEmail: false });
    expect((screen.getByRole('button', { name: /^Send \d+ emails? to/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('InviteTab_Viewer_And_SPL_SaysOnlyAdultsSendEmail', () => {
    renderTab({ canEmail: false });
    expect(screen.queryByText('Only adults send email')).not.toBeNull();
  });

  it('InviteTab_Viewer_And_SPL_TicksAreReadOnly', () => {
    renderTab({ canEmail: false });
    expect(screen.getByText('P10').closest('button')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('InviteTab_SendButton_CountsEmailsAndFamilies', () => {
    renderTab();
    expect(screen.getByRole('button', { name: 'Send 3 emails to 2 families' })).toBeTruthy();
  });

  it('InviteTab_Preview_UsesDigestRenderer', () => {
    renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: /^Preview email/ })[0]);
    const dialog = screen.getByRole('dialog');
    expect([digest.calls > 0, within(dialog).getByText(/Subject: Troop meeting on Sunday, October 25, 2026: invites for/) != null]).toEqual([true, true]);
  });

  it('InviteTab_Send_AnnouncesWhatWent', async () => {
    m.send.mockResolvedValue({ ok: true, sent: ['P30'], emails: 3, skipped: [], invited: 4, prior: 's', stamp: 's2' });
    m.sheet.mockResolvedValue({ ok: false, error: 'x' });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Send 3 emails to 2 families' }));
    await waitFor(() => expect(screen.getByText('Sent 3 emails.').getAttribute('role')).toBe('status'));
  });
});

describe('what left Build a Plan (B6)', () => {
  it('BuildRow_InviteLivesInOverflowMenu', () => {
    render(<BuildPlanView entryId={1} rows={[ROW]} canSeed canEdit stamp="s" heading={null} />);
    const loose = screen.queryByRole('button', { name: /^Invite/ });
    fireEvent.click(screen.getByRole('button', { name: 'More for First aid' }));
    expect([loose, screen.getByRole('link', { name: 'Invite' }).getAttribute('href')]).toEqual([null, '/planner/invite?meeting=1&offering=tenderfoot-4a']);
  });

  it('Build_NextInvite_IsThePrimary', () => {
    render(<BuildPlanView entryId={1} rows={[READY]} canSeed canEdit stamp="s" heading={null} />);
    expect(screen.getByRole('link', { name: 'Next: Invite →' }).getAttribute('href')).toBe('/planner/invite?meeting=1');
  });

  it('Build_EmptyPlan_HasNoNextInvite', () => {
    render(<BuildPlanView entryId={1} rows={[]} canSeed canEdit stamp="s" heading={null} />);
    expect(screen.queryByRole('link', { name: 'Next: Invite →' })).toBeNull();
  });

  it('Build_Rail_SaysNothingAboutInvited', () => {
    render(<BuildPlanView entryId={1} rows={[READY]} canSeed canEdit stamp="s" heading={null} />);
    expect(screen.queryByText(/invited/)).toBeNull();
  });
});

/** B6 qa follow-ups (2026-10-22). */
describe('B6 qa follow-ups', () => {
  const offeringButton = () => within(screen.getByRole('navigation', { name: 'Offerings' })).getByRole('button');

  it('InviteTab_Send_SkippedRecipientStaysTicked', async () => {
    // P10 and P12 went out (fresh asks in the refreshed data); the server skipped P11, who has no chip.
    m.send.mockResolvedValue({ ok: true, sent: ['P10', 'P12'], emails: 2, skipped: [{ name: 'P11', reason: 'didn’t go out' }], invited: 2, prior: 's', stamp: 's2' });
    const asked = { chip: 'recent' as const, askedAt: new Date().toISOString(), blocked: 'Asked in the last day' };
    m.sheet.mockResolvedValue({ ok: true, sections: [{ ...DATA.sections[0], scouts: [person(10, [40], asked), person(11, [40]), person(12, [40, 12], asked), person(14, [60], { likely: false })] }], recipients: RECIPIENTS });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Send 3 emails to 2 families' }));
    await waitFor(() => expect(screen.getAllByText('Asked <24h').length).toBe(2));
    expect(screen.getByText('P11').closest('button')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('InviteTab_PhoneDrill_FocusesTheDetailHeading', () => {
    renderTab({ initialKey: null });
    fireEvent.click(offeringButton());
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: /First aid/ }));
  });

  it('InviteTab_BackToOfferings_FocusesThatOffering', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: '← Offerings' }));
    expect(document.activeElement).toBe(offeringButton());
  });

  it('InviteTab_ReviewHeadingIds_StayUnique_WithTheDrawerOpen', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Send 3 emails · Review' }));
    expect(document.querySelectorAll('[id="invite-review"]').length).toBe(1);
  });

  it('InviteTab_Viewer_PhoneBar_HasNoSendCount', () => {
    renderTab({ canEmail: false });
    expect(screen.queryByRole('button', { name: /· Review$/ })).toBeNull();
  });

  it('InviteTab_Viewer_PhoneBar_SaysReview', () => {
    renderTab({ canEmail: false });
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy();
  });

  it('InviteTab_PreviewClose_ReturnsFocusToItsOpener', () => {
    renderTab();
    const opener = screen.getAllByRole('button', { name: /^Preview email/ })[0];
    fireEvent.click(opener);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(opener);
  });

  it('InviteTab_TickAllLikely_SkipsScoutsWhoSaidYes', () => {
    renderTab({ data: { ...DATA, sections: [{ ...DATA.sections[0], scouts: [person(10, [40]), person(11, [40], { chip: 'yes' })] }] } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tick all likely' }));
    expect(screen.getByText('P11').closest('button')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('InviteTab_Preview_HasNoInviteLink', () => {
    renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: /^Preview email/ })[0]);
    expect(screen.getByRole('dialog').innerHTML).not.toMatch(/\/i\//);
  });
});
