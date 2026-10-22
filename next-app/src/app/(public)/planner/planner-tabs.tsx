/** The planner's screens: Build a Plan (Build a Plan B1, first), the This Sunday board, Meeting Live (P4) and Focus sets (P3). */
import { TabStrip } from '@/app/_components/tab-strip';
import styles from './planner.module.css';

export function PlannerTabs({ active }: { active: 'build' | 'board' | 'live' | 'focus' }) {
  return (
    <div className={styles.tabs}>
      <TabStrip
        ariaLabel="Meeting Planner"
        activeKey={active}
        items={[
          { key: 'build', label: 'Build a Plan', href: '/planner/build' },
          { key: 'board', label: 'This Sunday', href: '/planner' },
          { key: 'live', label: 'Meeting Live', href: '/planner/live' },
          { key: 'focus', label: 'Focus sets', href: '/planner/focus-sets' }
        ]}
      />
    </div>
  );
}
