/**
 * Layout for the gated Leader Workspace. The /admin/login route is OUTSIDE
 * this route group so it doesn't get the workspace chrome. The /admin/*
 * proxy already redirects unauthenticated requests to /admin/login.
 */
import { SubNav } from './_components/sub-nav';
import { TopBar } from './_components/top-bar';
import styles from './admin.module.css';

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
