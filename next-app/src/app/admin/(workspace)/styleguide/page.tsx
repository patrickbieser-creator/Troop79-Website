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
      <PageTitle
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
    </>
  );
}
