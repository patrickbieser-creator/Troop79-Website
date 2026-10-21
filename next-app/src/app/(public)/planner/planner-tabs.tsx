/** The planner's two screens (P3): the This Sunday board and Focus sets. */
import { TabStrip } from '@/app/_components/tab-strip';
import styles from './planner.module.css';

export function PlannerTabs({ active }: { active: 'board' | 'focus' }) {
  return (
    <div className={styles.tabs}>
      <TabStrip
        ariaLabel="Meeting Planner"
        activeKey={active}
        items={[
          { key: 'board', label: 'This Sunday', href: '/planner' },
          { key: 'focus', label: 'Focus sets', href: '/planner/focus-sets' }
        ]}
      />
    </div>
  );
}
