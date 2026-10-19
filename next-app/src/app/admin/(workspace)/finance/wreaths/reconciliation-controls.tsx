'use client';

/**
 * The Reconciliation tab's toolbar controls (2026-10-19): the scout filter (a URL param, so the view is linkable and
 * the server renders only that scout), Print, and the CSV download of the visible rows. Components only: no constants
 * are exported from this client module (next-client-module-constants).
 */
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import styles from './wreaths.module.css';

export function ScoutFilter({ options, value }: { options: { value: string; label: string }[]; value: string }) {
  const router = useRouter();
  return (
    <label className={styles.amountLabel}>
      Scout
      <select
        aria-label="Scout"
        value={value}
        onChange={(e) => router.push(`/admin/finance/wreaths?tab=reconciliation${e.target.value ? `&scout=${e.target.value}` : ''}`)}
      >
        <option value="">All scouts</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PrintStatementButton() {
  return (
    <Button variant="secondary" size="sm" type="button" onClick={() => window.print()}>
      Print
    </Button>
  );
}

export function CsvDownloadButton({ csv, fileName }: { csv: string; fileName: string }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      type="button"
      onClick={() => {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      Download CSV
    </Button>
  );
}
