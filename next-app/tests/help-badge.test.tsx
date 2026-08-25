import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpBadge } from '../src/app/admin/_components/help-badge';
import Link from 'next/link';
import { HELP } from '../src/app/admin/help';

/**
 * The ? help badge (Patrick, 2026-08-25: reference material moves out of the
 * page lede into a badge beside the thing it explains). A POPOVER, not a
 * hover tooltip — WCAG 2.2 SC 1.4.13 wants it dismissible (Esc), persistent
 * (stays until dismissed), hoverable, and reachable by keyboard and touch.
 * Copy lives in the central help map, keyed by id, so it can be reviewed in
 * one place.
 */
describe('HelpBadge', () => {
  it('RendersAClosedButton_NamedForItsTopic_AndNoPopover', () => {
    render(<HelpBadge id="sample.short" />);
    const btn = screen.getByRole('button', { name: `Help: ${HELP['sample.short'].title}` });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Click_OpensThePopover_WithTheMapsTitleAndBody', async () => {
    const user = userEvent.setup();
    render(<HelpBadge id="sample.short" />);
    await user.click(screen.getByRole('button'));
    const pop = screen.getByRole('dialog', { name: HELP['sample.short'].title });
    expect(pop.textContent).toContain('one sentence');
    expect(screen.getByRole('button', { name: /Help:/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('Escape_ClosesIt_AndReturnsFocusToTheBadge', async () => {
    const user = userEvent.setup();
    render(<HelpBadge id="sample.short" />);
    const btn = screen.getByRole('button');
    await user.click(btn);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('ClickingOutside_ClosesIt', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <HelpBadge id="sample.short" />
        <p>elsewhere</p>
      </div>
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.click(screen.getByText('elsewhere'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('InlineContent_WorksWithoutAMapEntry_AndRichContentRenders', async () => {
    const user = userEvent.setup();
    render(
      <HelpBadge title="Going">
        <p>Counts <strong>yes</strong> replies.</p>
        <Link href="/admin/rosters">Event Management</Link>
      </HelpBadge>
    );
    await user.click(screen.getByRole('button', { name: 'Help: Going' }));
    expect(screen.getByRole('link', { name: 'Event Management' })).toBeTruthy();
  });

  it('UnknownId_Throws_SoATypoIsCaughtInDev', () => {
    expect(() => render(<HelpBadge id="nope.missing" />)).toThrow(/help map/);
  });
});
