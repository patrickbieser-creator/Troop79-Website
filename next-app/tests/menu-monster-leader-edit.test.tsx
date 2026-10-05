import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * A leader edits a scout's menu (Patrick, 2026-10-05: "Adult leaders need full rights to edit (and fix)
 * scout menus before they go shopping"). What each side is told under the menu's title: the leader that
 * their changes save and whose menu it is; the scout, afterwards, that a leader changed it.
 */
vi.mock('../src/app/(public)/library/menu-monster/menus/_components/copy-menu-button', () => ({ CopyMenuButton: () => null }));
vi.mock('../src/app/(public)/library/menu-monster/menus/_components/scout-menus', () => ({}));

import { ViewerAside } from '../src/app/(public)/library/menu-monster/menus/_components/viewer-aside';
import type { ViewableMenu } from '../src/app/(public)/library/menu-monster/menus/_components/scout-menus';

const view = (over: Partial<ViewableMenu> = {}): ViewableMenu =>
  ({
    stored: { id: 'm', ownerPersonId: 39, review: null, leaderEdit: null },
    access: 'owner',
    readOnly: false,
    helping: false,
    leaderEditBy: null,
    plannedBy: null,
    catalog: {},
    hiddenRecipes: 0,
    canCopy: false,
    ...over
  }) as unknown as ViewableMenu;

describe('ViewerAside — a leader editing a scout’s menu', () => {
  it('Leader_IsToldWhoseMenuItIs_AndThatTheirChangesSave', () => {
    render(<ViewerAside view={view({ access: 'admin', helping: true, plannedBy: 'Sam K.' })} page="plan" />);
    expect(screen.getByText('Planned by Sam K. · You’re editing it as a leader')).toBeTruthy();
    expect(screen.queryByText(/Read-only/)).toBeNull();
  });

  it('Scout_IsToldALeaderChangedTheirMenu_AndWhen', () => {
    const stored = { id: 'm', ownerPersonId: 39, review: null, leaderEdit: { at: '2026-10-05T15:00:00Z', byPersonId: 82 } };
    render(<ViewerAside view={view({ leaderEditBy: 'Patrick B.', stored: stored as unknown as ViewableMenu['stored'] })} page="plan" />);
    expect(screen.getByText('Patrick B. changed this menu on Oct 5, 2026.')).toBeTruthy();
  });

  it('Scout_SeesNoSuchNote_WhenNoLeaderHasChangedIt', () => {
    render(<ViewerAside view={view()} page="plan" />);
    expect(screen.queryByText(/changed this menu/)).toBeNull();
  });

  it('Parent_StillReadsReadOnly', () => {
    render(<ViewerAside view={view({ access: 'parent', readOnly: true, plannedBy: 'Sam K.' })} page="plan" />);
    expect(screen.getByText('Planned by Sam K. · Read-only')).toBeTruthy();
  });
});
