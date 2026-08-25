/**
 * /admin/styleguide — chooser between the two pattern libraries
 * (Plans/Public-Design-System.md Phase 0d, 2026-08-21):
 *
 *   Admin Styleguide  → /admin/styleguide/admin   (Leader Workspace patterns)
 *   Public Styleguide → /admin/styleguide/public  (public/editorial patterns)
 *
 * No page-level capability guard, deliberately: the workspace layout already
 * requires a resolved admin actor, and this page (like both guides) reads no
 * data and performs no writes — it renders static links/samples only. The nav
 * offers it to full admins (capability-less item semantics in sub-nav.tsx).
 */
import Link from 'next/link';
import { PageTitle } from '../_components/page-title';
import styles from './chooser.module.css';

export const metadata = {
  title: 'Styleguides — Troop 79'
};

export default function StyleguideChooser() {
  return (
    <>
      <PageTitle back={null}
        title="Styleguides"
        sub="Two pattern libraries, one discipline: canonical patterns rendered from the live production stylesheets, with the remaining drift tracked beside them."
      />
      <div className={styles.cards}>
        <Link href="/admin/styleguide/admin" className={styles.card}>
          <h2 className={styles.cardTitle}>Admin Styleguide</h2>
          <p className={styles.cardDesc}>
            Leader Workspace patterns &mdash; tokens, shared components, canon vs variants.
          </p>
        </Link>
        <Link href="/admin/styleguide/public" className={styles.card}>
          <h2 className={styles.cardTitle}>Public Styleguide</h2>
          <p className={styles.cardDesc}>
            Public site (editorial) patterns &mdash; tokens, shared components, remediation
            scoreboard.
          </p>
        </Link>
      </div>

      {/* Reference material Patrick asked to keep reachable (2026-08-25): the
          help-badge tuning page and the throwaway design prototypes. The
          prototypes are static files served from /public/prototypes. */}
      <h2 className={styles.groupTitle}>Prototypes &amp; samples</h2>
      <div className={styles.cards}>
        <Link href="/admin/styleguide/help-sample" className={styles.card}>
          <h2 className={styles.cardTitle}>Help badge sample</h2>
          <p className={styles.cardDesc}>The ? badge in every context it lives in, with knobs &mdash; tuned 2026-08-25.</p>
        </Link>
        <a href="/prototypes/admin-tables-prototype.html" className={styles.card}>
          <h2 className={styles.cardTitle}>Tables &amp; lists prototype</h2>
          <p className={styles.cardDesc}>The seven approved patterns: Compact, Card, Dense Grid, RecordList, Board, ExpandableSummary, PrintTable.</p>
        </a>
        <a href="/prototypes/admin-backnav-prototype.html" className={styles.card}>
          <h2 className={styles.cardTitle}>Back navigation prototype</h2>
          <p className={styles.cardDesc}>Back link vs breadcrumbs vs hybrid (chosen: hybrid, quiet text).</p>
        </a>
        <a href="/prototypes/admin-calendar-entry-editor-prototype.html" className={styles.card}>
          <h2 className={styles.cardTitle}>Calendar Entry editor prototype</h2>
          <p className={styles.cardDesc}>Details + Story consolidated on the news editor&rsquo;s shell (built as v1.95.0).</p>
        </a>
      </div>
    </>
  );
}
