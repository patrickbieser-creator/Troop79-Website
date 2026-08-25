import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, buttonClass } from '../src/app/admin/_components/button';

/** The shared admin Button (2026-08-24) — the contract every swept screen relies on. */
describe('admin Button', () => {
  it('Default_IsASecondaryButton_OfTypeButton', () => {
    render(<Button>Edit</Button>);
    const b = screen.getByRole('button', { name: 'Edit' });
    expect(b.getAttribute('type')).toBe('button');
    expect(b.className).toContain('secondary');
    expect(b.className).not.toContain('sm');
  });

  it('Href_RendersALink_WithTheSameClasses', () => {
    render(<Button href="/admin/calendar/1" variant="primary" size="sm" title="Open">Edit</Button>);
    const a = screen.getByRole('link', { name: 'Edit' });
    expect(a.getAttribute('href')).toBe('/admin/calendar/1');
    expect(a.getAttribute('title')).toBe('Open');
    expect(a.className).toContain('primary');
    expect(a.className).toContain('sm');
  });

  it('Submit_PassesThrough_AndDisabledBlocksClicks', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button type="submit" disabled onClick={onClick}>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b.getAttribute('type')).toBe('submit');
    await user.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ButtonClass_ComposesVariantSizeAndExtra', () => {
    const cls = buttonClass('danger', 'sm', 'mine');
    expect(cls).toContain('danger');
    expect(cls).toContain('sm');
    expect(cls).toContain('mine');
  });
});
