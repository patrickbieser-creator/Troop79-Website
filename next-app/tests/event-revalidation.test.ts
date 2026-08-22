import { describe, it, expect } from 'vitest';
import { eventRevalidatePaths } from '../src/lib/event-signup-shared';

/**
 * Which paths a signup edit has to flush (found 2026-08-22).
 *
 * `/events/{id}/signup` — the slot-first form families sign up on — was in no
 * revalidation list anywhere. It does not currently show as a bug: the page
 * awaits searchParams, so Next renders it dynamically. The gap is latent, and
 * one `export const revalidate` away from serving families a stale job date,
 * which is the worst place on the site for one — people turn up on the wrong
 * day.
 *
 * NOT the cause of the report that surfaced it. That was a duplicate job still
 * dated Sep 2 sitting alongside the corrected Sep 16 one; the public form was
 * rendering both correctly.
 */
describe('event signup — revalidation paths (pure)', () => {
  it('EventRevalidatePaths_IncludesThePublicSignupForm_NotJustTheEventPage', () => {
    const paths = eventRevalidatePaths(42, 7);
    expect(paths).toContain('/events/42');
    expect(paths).toContain('/events/42/signup');
  });

  it('EventRevalidatePaths_IncludesTheEventsIndex_AndTheAdminSurfaces', () => {
    const paths = eventRevalidatePaths(42, 7);
    expect(paths).toContain('/events');
    expect(paths).toContain('/admin/events');
    expect(paths).toContain('/admin/events/7');
  });

  it('EventRevalidatePaths_OmitsTheBuilderPath_WhenNoSignupIdIsKnown', () => {
    const paths = eventRevalidatePaths(42);
    expect(paths.some((p) => p.startsWith('/admin/events/'))).toBe(false);
    // The public pages still flush — the entry changed either way.
    expect(paths).toContain('/events/42/signup');
  });

  it('EventRevalidatePaths_HasNoDuplicates', () => {
    const paths = eventRevalidatePaths(42, 7);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
