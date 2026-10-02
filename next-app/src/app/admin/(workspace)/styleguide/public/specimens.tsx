/**
 * Client-side specimen wrappers for /admin/styleguide/public — the shared
 * TabStrip needs client state for its onSelect demo. Display-only.
 */
'use client';

import { useState } from 'react';
import { TabStrip } from '@/app/_components/tab-strip';
import sg from './public-styleguide.module.css';
import { AmountInput, Stepper } from '@/app/_components/stepper';

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

/** The shared compact dialer, live: a labelled Stepper (Label: − n +), a bare one at its minimum, and the framed cents box. */
export function PublicStepperSpecimen() {
  const [people, setPeople] = useState(8);
  const [days, setDays] = useState(1);
  return (
    <div className={sg.stepperSpecimen}>
      <Stepper
        id="sg-people"
        label="People"
        value={people}
        min={2}
        max={50}
        onChange={setPeople}
        groupLabel="People"
        lessLabel="One fewer person"
        moreLabel="One more person"
      />
      <Stepper
        id="sg-days"
        inputLabel="Days"
        value={days}
        min={1}
        max={14}
        onChange={setDays}
        groupLabel="Days (at its minimum, − is disabled)"
        lessLabel="One fewer day"
        moreLabel="One more day"
      />
      <span>
        $ <AmountInput aria-label="Amount, dollars and cents" defaultValue="12.50" min="0.01" step="0.01" />
      </span>
    </div>
  );
}
