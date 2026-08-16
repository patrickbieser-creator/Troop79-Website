import Link from 'next/link';
import { IS_DEV_DB } from '@/lib/dev-db';
import { logoutAction } from '../../login/actions';
import { identityLogoutAction } from '../../login/identity-logout';
import styles from '../admin.module.css';

/**
 * Takes the actor from the layout rather than re-reading the cookie
 * (Plans/Unified-Identity-And-Capabilities.md Phase B) — the layout has
 * already resolved it, including the capability read, so a second lookup here
 * would be a duplicate query per page load.
 */
export function TopBar({
  actorLabel,
  actorKind
}: {
  actorLabel: string;
  actorKind: 'legacy' | 'identity';
}) {
  return (
    <div className={`${styles.topBar} ${IS_DEV_DB ? styles.topBarDevDb : ''}`}>
      <div className={styles.topBarBrand}>
        Troop 79 Admin
        {IS_DEV_DB && <span className={styles.topBarDevTag}>DEV · LOCAL DATABASE</span>}
      </div>
      <div className={styles.topBarRight}>
        <span className={styles.topBarUser}>Signed in as {actorLabel}</span>
        <Link href="/" className={styles.topBarLink}>
          ← Public Site
        </Link>
        {/* Which cookie to clear depends on how they got here. Clearing the
            wrong one leaves the person apparently signed in but unable to act. */}
        <form action={actorKind === 'identity' ? identityLogoutAction : logoutAction}>
          <button type="submit" className={styles.topBarBtn}>
            Logout
          </button>
        </form>
      </div>
    </div>
  );
}
