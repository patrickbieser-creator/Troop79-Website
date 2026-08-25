import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StyleguideChooser from '../src/app/admin/(workspace)/styleguide/page';

/**
 * Phase 0d of Plans/Public-Design-System.md — /admin/styleguide becomes a
 * chooser between the two pattern libraries. The admin guide moved to
 * /admin/styleguide/admin; the public guide lives at /admin/styleguide/public.
 * This guards the chooser's contract: exactly two choices, one per guide.
 */
describe('StyleguideChooser', () => {
  it('StyleguideChooser_OffersTwoGuides_AndTheReferencePrototypes_WhenRendered', () => {
    render(<StyleguideChooser />);
    const links = screen.getAllByRole('link');
    // The two guides, plus the help-badge sample and the design prototypes
    // Patrick asked to keep reachable (2026-08-25).
    expect(links.map((a) => a.getAttribute('href')).sort()).toEqual([
      '/admin/styleguide/admin',
      '/admin/styleguide/help-sample',
      '/admin/styleguide/public',
      '/prototypes/admin-backnav-prototype.html',
      '/prototypes/admin-calendar-entry-editor-prototype.html',
      '/prototypes/admin-tables-prototype.html'
    ]);
  });
});
