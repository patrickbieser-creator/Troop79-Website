'use client';

/**
 * The "which scout's progress is showing" control at the top of /library
 * (Patrick, 2026-08-07). Renders nothing for a 'none' viewer (anonymous,
 * Tier 1 family, unauthorized leader) or a Tier 2-S scout (one scout, no
 * toggle) or a Tier 2 adult with exactly one scout (nothing to switch to).
 *
 * Two distinct render modes, matching lib/library-viewer.ts's two "someone
 * COULD see more than default" cases:
 *   - 'scout' with switchOptions.length > 1 — a signed-in household with
 *     more than one scout. Pre-selected to whoever's showing now.
 *   - 'proxy-available' — an authorized superuser leader who hasn't picked
 *     anyone yet. No pre-selection (a leader has no "default" scout) — the
 *     placeholder option is real, not just a label, so navigating away
 *     without choosing does nothing rather than silently picking #1.
 *
 * Only ever renders on /library itself — a plain <select onChange> that
 * navigates, only a type import from the server-only viewer module (types
 * are erased at build time, so this stays a client component with no server
 * code bundled in).
 */
import { useRouter } from 'next/navigation';
import type { LibraryViewer } from '@/lib/library-viewer';
import styles from '../library.module.css';

export function ScoutSwitcher({ viewer }: { viewer: LibraryViewer }) {
  const router = useRouter();

  if (viewer.kind === 'proxy-available') {
    return (
      <div className={styles.proxyBanner}>
        <span className={styles.proxyBannerLabel}>Superuser:</span>
        <span>view the library as any active scout —</span>
        <select
          className={styles.scoutSwitcherSelect}
          defaultValue=""
          aria-label="Choose a scout to view the library as"
          onChange={(e) => {
            if (e.target.value) router.push(`/library?viewScout=${encodeURIComponent(e.target.value)}`);
          }}
        >
          <option value="" disabled>
            — choose a scout —
          </option>
          {viewer.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (viewer.kind !== 'scout') return null;

  if (viewer.isProxy) {
    return (
      <div className={styles.proxyBanner}>
        <span className={styles.proxyBannerLabel}>Viewing as {viewer.scoutName}</span>
        <select
          className={styles.scoutSwitcherSelect}
          defaultValue={viewer.scoutId}
          aria-label="Choose a different scout to view the library as"
          onChange={(e) => router.push(`/library?viewScout=${encodeURIComponent(e.target.value)}`)}
        >
          {viewer.switchOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <a href="/library" className={styles.divLink}>
          Exit proxy view
        </a>
      </div>
    );
  }

  if (viewer.switchOptions.length <= 1) return null;

  return (
    <div className={styles.scoutSwitcher}>
      <span className={styles.scoutSwitcherLabel}>Showing progress for</span>
      <select
        className={styles.scoutSwitcherSelect}
        defaultValue={viewer.scoutId}
        aria-label="Choose which scout's progress to show"
        onChange={(e) => router.push(`/library?viewScout=${encodeURIComponent(e.target.value)}`)}
      >
        {viewer.switchOptions.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
