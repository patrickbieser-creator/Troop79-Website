/**
 * /admin/login — no longer a login.
 *
 * LEADER_PASSWORD retired 2026-08-16 (Plans/Unified-Identity-And-Capabilities.md
 * Phase E). Leaders sign in as themselves at /signin and get exactly the
 * capabilities attached to their person record; there is no shared secret to
 * know, and no second identity to reconcile.
 *
 * The route survives because proxy.ts still redirects unauthenticated /admin
 * requests here with ?next=, and because bookmarks and muscle memory exist.
 * It forwards that ?next= into the real sign-in so a bookmarked deep link
 * still lands where it meant to.
 *
 * Recovery, when email itself is broken: next-app/scripts/break-glass.mjs
 * mints a code straight against the database. Deliberately a script and not a
 * web path — see its header.
 */
import Link from 'next/link';
import { IS_DEV_DB } from '@/lib/dev-db';
import { safeInternalPath } from '@/lib/safe-redirect';
import styles from './login.module.css';
// This route sits OUTSIDE the (workspace) group, so the workspace layout's
// admin.css import never loads here — pull the token sheet in directly.
import '../(workspace)/admin.css';

export const metadata = {
  title: IS_DEV_DB ? '[DEV] Sign In — Troop 79 Admin' : 'Sign In — Troop 79 Admin'
};

export default async function AdminLoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeInternalPath(next ?? '/admin/advancement', '/admin/advancement');

  return (
    <main className={styles.wrap}>
      <div className={styles.panel}>
        <h1 className={styles.title}>Sign in to Troop 79</h1>
        <p className={styles.lede}>
          The shared leader password is gone. Sign in as yourself and you&rsquo;ll get the parts of
          the admin you&rsquo;re responsible for &mdash; and your own family&rsquo;s pages, without
          a second sign-in.
        </p>
        <p>
          <Link href={`/signin?next=${encodeURIComponent(target)}`} className={styles.cta}>
            Continue to sign in
          </Link>
        </p>
        <p className={styles.hint}>
          No access after signing in? A troop admin grants it on Access &amp; Permissions.
        </p>
        <p className={styles.backRow}>
          <Link href="/" className={styles.backLink}>
            &larr; Back to public site
          </Link>
        </p>
      </div>
    </main>
  );
}
