/**
 * Layout for the gated Leader Workspace. The /admin/login route is OUTSIDE
 * this route group so it doesn't get the workspace chrome. The /admin/*
 * proxy already redirects unauthenticated requests to /admin/login.
 */
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { SubNav } from './_components/sub-nav';
import { TopBar } from './_components/top-bar';
import { IS_DEV_DB } from '@/lib/dev-db';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import styles from './admin.module.css';

export const metadata: Metadata = IS_DEV_DB
  ? { title: { template: '[DEV] %s', default: '[DEV] Troop 79 Admin' } }
  : { title: { template: '%s', default: 'Troop 79 Admin' } };

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  // The proxy already guarantees a valid session reaches this layout.
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  const role = session?.role ?? 'leader';

  return (
    <div className={styles.adminRoot}>
      <TopBar />
      <div className={styles.workspace}>
        <SubNav role={role} />
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
