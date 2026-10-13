/**
 * The Reports landing page body (/admin/reports). Presentational: the entries come from folderEntries() in nav-data,
 * so a report added there appears here with no second list. Reuses the Home hub card, one card per report.
 */
import { AdminHubGrid } from './admin-hub';
import type { FolderEntry } from './nav-data';
import styles from './admin-hub.module.css';

export function ReportsLanding({ entries }: { entries: FolderEntry[] }) {
  if (entries.length === 0) {
    return <p className={styles.empty}>No reports are open to you yet. Ask a troop admin for access.</p>;
  }
  return (
    <AdminHubGrid
      cards={entries.map((e) => ({ key: e.href, title: e.label, description: e.description, href: e.href }))}
    />
  );
}
