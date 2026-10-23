/**
 * The planner's screens: Who's coming first (attendance and replies, at /planner: links in emails point there;
 * Patrick, 2026-10-22), then Build a Plan (Decision 4), Invite (B6: invites come after the plan is built), Meeting Live
 * (P4), Focus sets (P3), and Has/Needs (B7: who has a requirement, who needs it), last. Six tabs: the strip scrolls sideways on a
 * phone rather than wrapping.
 */
import { TabStrip } from '@/app/_components/tab-strip';
import styles from './planner.module.css';

export function PlannerTabs({ active }: { active: 'build' | 'invite' | 'board' | 'live' | 'focus' | 'hasneeds' }) {
  return (
    <div className={styles.tabs}>
      <TabStrip
        ariaLabel="Meeting Planner"
        scroll
        activeKey={active}
        items={[
          { key: 'board', label: 'Who’s coming', href: '/planner' },
          { key: 'build', label: 'Build a Plan', href: '/planner/build' },
          { key: 'invite', label: 'Invite', href: '/planner/invite' },
          { key: 'live', label: 'Rotations', href: '/planner/rotations' },
          { key: 'focus', label: 'Focus sets', href: '/planner/focus-sets' },
          { key: 'hasneeds', label: 'Has/Needs', href: '/planner/has-needs' }
        ]}
      />
    </div>
  );
}
