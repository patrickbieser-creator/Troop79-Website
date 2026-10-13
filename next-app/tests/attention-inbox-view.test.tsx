import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttentionInbox, type InboxRow } from '../src/app/admin/(workspace)/_components/attention-inbox';

/** Home's "Needs you today" inbox — the presentational half (Plans/Admin-Home-And-Nav.md). */

const ROW: InboxRow = {
  key: 'reimbursements',
  label: 'Reimbursements to approve',
  count: 3,
  unit: 'to approve',
  meta: '$412.68 total',
  href: '/admin/finance/reimbursements',
  tone: 'money'
};

describe('AttentionInbox view', () => {
  it('AttentionInbox_SaysNothingNeedsYou_WhenEveryQueueIsEmpty', () => {
    render(<AttentionInbox rows={[]} />);
    expect(screen.getByText('Nothing needs you today.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('AttentionInbox_LinksTheWholeRowToItsQueue_WithTheCount', () => {
    render(<AttentionInbox rows={[ROW]} />);
    const link = screen.getByRole('link', { name: /Reimbursements to approve/ });
    expect(link.getAttribute('href')).toBe('/admin/finance/reimbursements');
    expect(link.textContent).toContain('3');
    expect(link.textContent).toContain('to approve');
  });

  it('AttentionInbox_OmitsTheMetaLine_WhenThereIsNothingToSay', () => {
    render(<AttentionInbox rows={[{ ...ROW, meta: '' }]} />);
    expect(screen.getByRole('link').textContent).not.toContain('$');
  });
});
