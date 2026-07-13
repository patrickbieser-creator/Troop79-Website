import { cookies } from 'next/headers';
import Link from 'next/link';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { IS_DEV_DB } from '@/lib/dev-db';
import { logoutAction } from '../../login/actions';
import styles from '../admin.module.css';

export async function TopBar() {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  return (
    <div className={`${styles.topBar} ${IS_DEV_DB ? styles.topBarDevDb : ''}`}>
      <div className={styles.topBarBrand}>
        Troop 79 Admin
        {IS_DEV_DB && <span className={styles.topBarDevTag}>DEV · LOCAL DATABASE</span>}
      </div>
      <div className={styles.topBarRight}>
        {session && (
          <span className={styles.topBarUser}>
            Signed in as {session.leader} ({session.role === 'scout' ? 'Scout' : 'Leader'})
          </span>
        )}
        <Link href="/" className={styles.topBarLink}>
          ← Public Site
        </Link>
        <form action={logoutAction}>
          <button type="submit" className={styles.topBarBtn}>
            Logout
          </button>
        </form>
      </div>
    </div>
  );
}
