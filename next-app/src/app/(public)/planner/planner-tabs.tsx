/**
 * The planner's screens (Plans/Meeting-Planner-III.md): This week first (the plan, the checklist and Live at the
 * meeting, at /planner: links in emails point there), then Emails (adult editors), Focus sets and Has/Needs. Teacher asks are each teacher
 * slot's Ask by email; the Theme calendar is linked from This week's header. Suggestions (what scouts need next, from
 * the ledger) comes last. The strip
 * scrolls sideways on a phone rather than wrapping.
 */
import { TabStrip } from '@/app/_components/tab-strip';
import styles from './planner.module.css';

export function PlannerTabs({ active, canEmail = false }: { active: 'week' | 'emails' | 'invite' | 'focus' | 'hasneeds' | 'suggestions' | 'build' | 'board' | 'live'; canEmail?: boolean }) {
  return (
    <div className={styles.tabs}>
      <TabStrip
        ariaLabel="Meeting Planner"
        scroll
        activeKey={active}
        items={[
          { key: 'week', label: 'This week', href: '/planner' },
          // Every email about a meeting (Emails E3): adults who can edit the planner only (plannerAccess canEmail).
          ...(canEmail ? [{ key: 'emails', label: 'Emails', href: '/planner/emails' }] : []),
          { key: 'focus', label: 'Focus sets', href: '/planner/focus-sets' },
          { key: 'hasneeds', label: 'Has/Needs', href: '/planner/has-needs' },
          { key: 'suggestions', label: 'Suggestions', href: '/planner/suggestions' }
        ]}
      />
    </div>
  );
}
