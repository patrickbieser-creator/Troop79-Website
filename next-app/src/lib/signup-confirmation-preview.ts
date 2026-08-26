/**
 * The message editor's PREVIEW context (Plans/Signup-Confirmation-Email.md):
 * this event's real logistics — title, dates, location, deadline, payment
 * instructions — with a sample family standing in for the household, so a
 * leader sees what the merge fields will say before anyone signs up. Pure,
 * so the builder loader and the library page can both build one.
 */

import { applyBlocks, type ConfirmationContext, type SignupBlocks } from './signup-confirmation';

export interface PreviewEventInput {
  entryId: number;
  title: string;
  entryDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  /** timestamptz or date; sliced to the calendar day. */
  deadline?: string | null;
  paymentInstructions?: string | null;
  siteUrl: string;
  /** The blocks this signup offers — sample facts for a block that is off are dropped. Omit = all on. */
  blocks?: SignupBlocks;
}

export const SAMPLE_SCOUT = 'Avery Scout';
export const SAMPLE_ADULT = 'Dana Bieser';

export function previewContext(e: PreviewEventInput): ConfirmationContext {
  const ctx: ConfirmationContext = {
    event: {
      title: e.title,
      entryDate: e.entryDate,
      endDate: e.endDate ?? null,
      startTime: e.startTime ?? null,
      endTime: e.endTime ?? null,
      location: e.location ?? null,
      deadline: e.deadline ? String(e.deadline).slice(0, 10) : null,
      publicUrl: `${e.siteUrl}/events/${e.entryId}`,
      rosterUrl: `${e.siteUrl}/admin/calendar/${e.entryId}?tab=signup&view=roster`,
      headcount: '12 going'
    },
    household: {
      label: 'The Bieser family',
      submitterName: SAMPLE_ADULT,
      submitterEmail: 'dana@example.com',
      submitterPhone: '(414) 555-0179',
      people: [
        { name: SAMPLE_SCOUT, isAdult: false, status: 'yes' },
        { name: SAMPLE_ADULT, isAdult: true, status: 'yes' }
      ],
      guests: [],
      days: [],
      jobs: ['Grubmaster'],
      rides: ['Driving out (4 seats)'],
      answers: [],
      notes: [],
      slip: [],
      prices: [`${SAMPLE_SCOUT} — Scout $45`, `${SAMPLE_ADULT} — Adult $30`],
      amountDue: 75,
      paid: 0,
      payment: e.paymentInstructions ?? null
    },
    change: 'new',
    changes: null
  };
  return e.blocks ? applyBlocks(ctx, e.blocks) : ctx;
}

/** A library-page preview with no event in hand: a plausible campout. */
export function samplePreviewContext(siteUrl = ''): ConfirmationContext {
  return previewContext({
    entryId: 0,
    title: 'Fall Campout',
    entryDate: '2026-10-09',
    endDate: '2026-10-11',
    startTime: '17:00:00',
    endTime: '11:00:00',
    location: 'Camp Long Lake, St. Cloud, WI',
    deadline: '2026-10-04',
    paymentInstructions: 'Venmo @troop79 or a check to the treasurer.',
    siteUrl
  });
}
