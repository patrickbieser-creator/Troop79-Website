/**
 * Layout for the gated Leader Workspace. The /admin/login route is OUTSIDE
 * this route group so it doesn't get the workspace chrome. The /admin/*
 * proxy already redirects unauthenticated requests to /admin/login.
 */
import type { Metadata } from 'next';
import { SubNav } from './_components/sub-nav';
import { TopBar } from './_components/top-bar';
import { IS_DEV_DB } from '@/lib/dev-db';
import styles from './admin.module.css';

export const metadata: Metadata = IS_DEV_DB
  ? { title: { template: '[DEV] %s', default: '[DEV] Troop 79 Admin' } }
  : { title: { template: '%s', default: 'Troop 79 Admin' } };

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.adminRoot}>
      <TopBar />
      <div className={styles.workspace}>
        <SubNav />
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
