import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessTable } from '../src/app/admin/(workspace)/access/access-table';
import type { GrantRow } from '../src/lib/capabilities-admin';

/**
 * The Access & Permissions grid (Plans/Unified-Identity-And-Capabilities.md
 * Phase A).
 *
 * A 7-column grid of bare checkmarks is the kind of UI that is trivially
 * unusable and untestable at the same time — every cell would have the
 * accessible name "✓". These tests query by role + accessible name only, so
 * they fail if the person/capability pairing ever stops being announced.
 *
 * Mock boundary is the server action (Tests/CLAUDE.md): assert on the
 * FormData the component builds, not on what the action would do with it.
 */

function makeRow(over: Partial<GrantRow> = {}): GrantRow {
  return {
    personId: 501,
    name: 'Dana Reilly',
    leaderCode: 'DR',
    isActiveScout: false,
    capabilities: ['news.write'],
    grantedBy: { 'news.write': 'Patrick B' },
    grantedAt: { 'news.write': '2026-08-16T00:00:00Z' },
    ...over
  };
}

function actions() {
  return {
    grantAction: vi.fn().mockResolvedValue(undefined),
    revokeAction: vi.fn().mockResolvedValue(undefined),
    applyBundleAction: vi.fn().mockResolvedValue(undefined),
    revokeAllAction: vi.fn().mockResolvedValue(undefined),
    revokeSessionsAction: vi.fn().mockResolvedValue(undefined)
  };
}

describe('AccessTable', () => {
  it('CapabilityCell_AnnouncesPersonAndCapability_WhenRendered', () => {
    const a = actions();
    render(<AccessTable rows={[makeRow()]} addable={[]} {...a} />);
    // Not "✓" — the pairing has to be in the accessible name or the grid is
    // unnavigable by screen reader and ambiguous to a test.
    expect(screen.getByRole('button', { name: 'Publish news — Dana Reilly' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage the roster — Dana Reilly' })).toBeTruthy();
  });

  it('CapabilityCell_ReflectsHeldState_WhenGrantExists', () => {
    const a = actions();
    render(<AccessTable rows={[makeRow()]} addable={[]} {...a} />);
    expect(
      screen.getByRole('button', { name: 'Publish news — Dana Reilly' }).getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Manage the roster — Dana Reilly' }).getAttribute('aria-pressed')
    ).toBe('false');
  });

  it('Toggle_CallsGrant_WhenCapabilityIsNotHeld', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<AccessTable rows={[makeRow()]} addable={[]} {...a} />);

    await user.click(screen.getByRole('button', { name: 'Manage the roster — Dana Reilly' }));

    expect(a.grantAction).toHaveBeenCalledTimes(1);
    expect(a.revokeAction).not.toHaveBeenCalled();
    const fd = a.grantAction.mock.calls[0][0] as FormData;
    expect(fd.get('personId')).toBe('501');
    expect(fd.get('capability')).toBe('roster.manage');
  });

  it('Toggle_CallsRevoke_WhenCapabilityIsAlreadyHeld', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<AccessTable rows={[makeRow()]} addable={[]} {...a} />);

    await user.click(screen.getByRole('button', { name: 'Publish news — Dana Reilly' }));

    expect(a.revokeAction).toHaveBeenCalledTimes(1);
    expect(a.grantAction).not.toHaveBeenCalled();
    const fd = a.revokeAction.mock.calls[0][0] as FormData;
    expect(fd.get('capability')).toBe('news.write');
  });

  it('Bundle_PostsBundleKey_WhenApplied', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<AccessTable rows={[makeRow()]} addable={[]} {...a} />);

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Bundle for Dana Reilly' }),
      'advancement_chair'
    );
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(a.applyBundleAction).toHaveBeenCalledTimes(1);
    const fd = a.applyBundleAction.mock.calls[0][0] as FormData;
    expect(fd.get('bundle')).toBe('advancement_chair');
    expect(fd.get('personId')).toBe('501');
  });

  it('ApplyButton_IsDisabled_WhenNoBundleChosen', () => {
    const a = actions();
    render(<AccessTable rows={[makeRow()]} addable={[]} {...a} />);
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('YouthMember_IsLabelled_WhenActiveScout', () => {
    const a = actions();
    render(
      <AccessTable
        rows={[makeRow({ name: 'Sam Porter', isActiveScout: true, capabilities: ['meeting_plan.use'] })]}
        addable={[]}
        {...a}
      />
    );
    // A youth CAN hold a grant (an SPL with meeting_plan.use). The screen has
    // to say so out loud, because handing a scout roster.manage by misclick is
    // the failure this whole table exists to make visible.
    expect(screen.getByRole('rowheader', { name: /Sam Porter/ }).textContent).toContain('youth');
  });

  it('ClearGrants_IsDisabled_WhenPersonHoldsNone', () => {
    const a = actions();
    render(<AccessTable rows={[makeRow({ capabilities: [], grantedBy: {}, grantedAt: {} })]} addable={[]} {...a} />);
    expect((screen.getByRole('button', { name: 'Clear grants' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('RevokeSessions_PostsPersonId_WhenClicked', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<AccessTable rows={[makeRow()]} addable={[]} {...a} />);

    await user.click(screen.getByRole('button', { name: 'Revoke sessions' }));

    expect(a.revokeSessionsAction).toHaveBeenCalledTimes(1);
    const fd = a.revokeSessionsAction.mock.calls[0][0] as FormData;
    expect(fd.get('personId')).toBe('501');
  });
});
