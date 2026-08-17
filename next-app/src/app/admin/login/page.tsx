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
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1b2027',
        padding: 24
      }}
    >
      <div style={{ maxWidth: 420, width: '100%', color: '#c9ced6', textAlign: 'center' }}>
        <h1 style={{ color: '#fff', fontSize: 22, marginBottom: 12 }}>Sign in to Troop 79</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
          The shared leader password is gone. Sign in as yourself and you&rsquo;ll get the parts of
          the admin you&rsquo;re responsible for &mdash; and your own family&rsquo;s pages, without
          a second sign-in.
        </p>
        <p>
          <Link
            href={`/signin?next=${encodeURIComponent(target)}`}
            style={{
              display: 'inline-block',
              background: '#3d7a4a',
              color: '#fff',
              padding: '11px 22px',
              borderRadius: 3,
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: '.04em',
              textTransform: 'uppercase'
            }}
          >
            Continue to sign in
          </Link>
        </p>
        <p style={{ fontSize: 12, color: '#9ba1aa', marginTop: 22, lineHeight: 1.6 }}>
          No access after signing in? A troop admin grants it on Access &amp; Permissions.
        </p>
        <p style={{ fontSize: 12, marginTop: 14 }}>
          <Link href="/" style={{ color: '#3d7a4a', fontWeight: 600 }}>
            &larr; Back to public site
          </Link>
        </p>
      </div>
    </main>
  );
}
