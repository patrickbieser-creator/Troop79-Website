/**
 * The "Superuser:" banner on the Members pages (/member, /profile,
 * /member/reimbursements) — Patrick, 2026-10-13. Matches the Scout account
 * banner. Three states, all driven by lib/member-viewer.ts's MemberViewer:
 *   - not proxying (offer):  "Superuser: view Members as any active scout" + picker
 *   - proxying:              "Viewing as <name>'s family (leader view)" + switch + Exit
 * A GET form with no action re-requests the current page with ?viewScout=,
 * so the same banner works on every page that renders it. Renders nothing
 * for a viewer with no proxy rights.
 */
import Link from 'next/link';
import { Notice } from '@/app/_components/notice';
import type { MemberViewer } from '@/lib/member-viewer';
import styles from './member.module.css';

export function MemberProxyBanner({ viewer }: { viewer: MemberViewer }) {
  if (viewer.kind === 'own' && viewer.switchOptions.length === 0) return null;

  if (viewer.kind === 'proxy') {
    return (
      <Notice tone="warning" className={styles.proxyBanner}>
        <span>
          Viewing as <strong>{viewer.name}</strong>&rsquo;s family (leader view)
        </span>
        <form method="get" className={styles.proxyForm}>
          <select name="viewScout" aria-label="Switch scout" defaultValue={String(viewer.personId)}>
            {viewer.switchOptions.map((o) => (
              <option key={o.personId} value={o.personId}>
                {o.name}
              </option>
            ))}
          </select>
          <button type="submit">Switch</button>
          <Link href="/member">Exit proxy view</Link>
        </form>
      </Notice>
    );
  }

  const options = viewer.kind === 'proxy-available' ? viewer.options : viewer.switchOptions;
  return (
    <Notice tone="warning" className={styles.proxyBanner}>
      <span>Superuser: view Members as any active scout &mdash;</span>
      <form method="get" className={styles.proxyForm}>
        <select name="viewScout" aria-label="View as scout" defaultValue="" required>
          <option value="" disabled>
            Choose a scout&hellip;
          </option>
          {options.map((o) => (
            <option key={o.personId} value={o.personId}>
              {o.name}
            </option>
          ))}
        </select>
        <button type="submit">View</button>
      </form>
    </Notice>
  );
}
