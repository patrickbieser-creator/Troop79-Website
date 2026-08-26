import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PublicPageLink } from '../src/app/admin/_components/public-page-link';

/** One admin→public link (Patrick + Jenna, 2026-08-25): secondary/sm, same tab, never hidden. */
describe('PublicPageLink', () => {
  it('PublicPageLink_IsASecondarySmallLink_LabelledViewPublicPage', () => {
    render(<PublicPageLink href="/events/7" />);
    const a = screen.getByRole('link', { name: 'View public page' });
    expect(a.getAttribute('href')).toBe('/events/7');
    expect(a.getAttribute('target')).toBeNull();
    expect(a.className).toContain('secondary');
    expect(a.className).toContain('sm');
  });

  it('PublicPageLink_SaysPreviewUnpublished_ForADraft_ButStillLinks', () => {
    render(<PublicPageLink href="/news/fall-campout" draft />);
    expect(screen.getByRole('link', { name: 'Preview (unpublished)' }).getAttribute('href')).toBe('/news/fall-campout');
  });
});
