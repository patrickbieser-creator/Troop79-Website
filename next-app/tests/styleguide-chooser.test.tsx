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
  it('StyleguideChooser_OffersTwoGuides_WhenRendered', () => {
    render(<StyleguideChooser />);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href')).sort()).toEqual([
      '/admin/styleguide/admin',
      '/admin/styleguide/public'
    ]);
  });
});
