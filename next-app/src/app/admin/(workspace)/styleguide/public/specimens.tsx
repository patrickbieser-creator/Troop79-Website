/**
 * Client-side specimen wrappers for /admin/styleguide/public — the shared
 * TabStrip needs client state for its onSelect demo. Display-only.
 */
'use client';

import { useState } from 'react';
import { TabStrip } from '@/app/_components/tab-strip';

export function PublicTabStripSpecimen() {
  const [active, setActive] = useState('week');
  return (
    <TabStrip
      ariaLabel="TabStrip specimen"
      activeKey={active}
      items={[
        { key: 'week', label: 'This Week', count: 4, onSelect: () => setActive('week') },
        { key: 'month', label: 'This Month', onSelect: () => setActive('month') },
        { key: 'all', label: 'All', count: 132, onSelect: () => setActive('all') }
      ]}
    />
  );
}
