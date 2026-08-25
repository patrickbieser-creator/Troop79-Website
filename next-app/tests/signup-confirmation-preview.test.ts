import { describe, it, expect } from 'vitest';
import { previewContext, samplePreviewContext, SAMPLE_ADULT, SAMPLE_SCOUT } from '../src/lib/signup-confirmation-preview';
import { renderMessage, DEFAULT_TEMPLATES } from '../src/lib/signup-confirmation';

/**
 * The message editor previews with the event's REAL logistics and a sample
 * family (Plans/Signup-Confirmation-Email.md) — never a real household.
 */
describe('previewContext', () => {
  it('PreviewContext_UsesTheEventsRealLogistics_AndSamplePeople', () => {
    const ctx = previewContext({
      entryId: 42,
      title: 'Winter Campout',
      entryDate: '2027-01-15',
      endDate: '2027-01-17',
      location: 'Camp Long Lake',
      deadline: '2027-01-10T18:00:00Z',
      paymentInstructions: 'Venmo @troop79',
      siteUrl: 'https://www.troop-79.com'
    });
    expect(ctx.event.title).toBe('Winter Campout');
    expect(ctx.event.deadline).toBe('2027-01-10');
    expect(ctx.event.publicUrl).toBe('https://www.troop-79.com/events/42');
    expect(ctx.event.rosterUrl).toContain('/admin/calendar/42?tab=signup&view=roster');
    expect(ctx.household.payment).toBe('Venmo @troop79');
    expect(ctx.household.people.map((p) => p.name)).toEqual([SAMPLE_SCOUT, SAMPLE_ADULT]);
    expect(ctx.household.submitterName).toBe(SAMPLE_ADULT);
    expect(ctx.change).toBe('new');
  });

  it('PreviewContext_RendersTheDefaultFamilyTemplate_WithEveryEventToken', () => {
    const ctx = previewContext({
      entryId: 7,
      title: 'Fall Campout',
      entryDate: '2026-10-09',
      endDate: '2026-10-11',
      location: 'Camp Long Lake',
      deadline: '2026-10-04',
      siteUrl: ''
    });
    const out = renderMessage(DEFAULT_TEMPLATES.family, ctx, 'family');
    expect(out.subject).toBe('Signed up: Fall Campout');
    expect(out.body).toContain('Hi Dana Bieser');
    expect(out.body).toContain('Camp Long Lake');
    expect(out.body).toContain('$75.00');
    expect(out.body).not.toMatch(/\[(event|date|location|deadline|amount_due)\]/);
    expect(out.summaryLines.some((l) => l.startsWith('Going:'))).toBe(true);
  });

  it('SamplePreviewContext_IsAPlausibleCampout_ForTheLibraryPage', () => {
    const ctx = samplePreviewContext();
    expect(ctx.event.title).toBe('Fall Campout');
    expect(ctx.event.location).toBeTruthy();
    expect(ctx.event.endDate).not.toBeNull();
  });
});
