/**
 * The planner's screens (Plans/Meeting-Planner-III.md): This week first (the plan, the checklist and Live at the
 * meeting, at /planner: links in emails point there), then Focus sets and Has/Needs. Teacher asks are each teacher
 * slot's Ask by email; the Theme calendar is linked from This week's header. The strip
 * scrolls sideways on a phone rather than wrapping.
 */
import { TabStrip } from '@/app/_components/tab-strip';
import styles from './planner.module.css';

export function PlannerTabs({ active }: { active: 'week' | 'invite' | 'focus' | 'hasneeds' | 'build' | 'board' | 'live' }) {
  return (
    <div className={styles.tabs}>
      <TabStrip
        ariaLabel="Meeting Planner"
        scroll
        activeKey={active}
        items={[
          { key: 'week', label: 'This week', href: '/planner' },
          { key: 'focus', label: 'Focus sets', href: '/planner/focus-sets' },
          { key: 'hasneeds', label: 'Has/Needs', href: '/planner/has-needs' }
        ]}
      />
    </div>
  );
}
