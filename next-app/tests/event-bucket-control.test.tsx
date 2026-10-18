import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Bucket } from '../src/lib/buckets';

const setEventBucketAction = vi.fn<(entry: number, bucket: number | null) => Promise<{ ok: boolean; moved: number }>>(async () => ({ ok: true, moved: 2 }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../src/app/admin/(workspace)/finance/bucket-actions', () => ({
  setEventBucketAction: (e: number, b: number | null) => setEventBucketAction(e, b),
  createBucketAction: vi.fn()
}));

import { EventBucketControl } from '../src/app/admin/(workspace)/finance/event-bucket-control';

/** An event's bucket — one control on the event's Money tab and on the calendar workbench (Patrick, 2026-10-18). */
const BUCKETS: Bucket[] = [
  { id: 18, name: "High Cliff Fall '26", isEvent: true, lastUsed: '2026-10-09' },
  { id: 17, name: "High Adventure Trip '26", isEvent: false, lastUsed: '2026-06-29' }
];

describe('EventBucketControl', () => {
  it('ShowsTheEventsCurrentBucket', () => {
    render(<EventBucketControl calendarEntryId={35} bucketId={18} buckets={BUCKETS} />);
    expect((screen.getByRole('combobox', { name: 'Bucket' }) as HTMLInputElement).value).toBe("High Cliff Fall '26");
  });

  it('Leader_CanPutAnEventInABucket_AndSeesHowManyRowsMoved', async () => {
    const user = userEvent.setup();
    render(<EventBucketControl calendarEntryId={17} bucketId={null} buckets={BUCKETS} />);
    await user.click(screen.getByRole('combobox', { name: 'Bucket' }));
    await user.click(screen.getByRole('option', { name: /High Adventure/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/2 of this event/));
    expect(setEventBucketAction).toHaveBeenCalledWith(17, 17);
  });
});
