import { cookies } from 'next/headers';
import Link from 'next/link';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { logoutAction } from '../../login/actions';
import styles from '../admin.module.css';

export async function TopBar() {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  return (
    <div className={styles.topBar}>
      <div className={styles.topBarBrand}>Troop 79 Admin</div>
      <div className={styles.topBarRight}>
        {session && (
          <span className={styles.topBarUser}>Signed in as {session.leader}</span>
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
