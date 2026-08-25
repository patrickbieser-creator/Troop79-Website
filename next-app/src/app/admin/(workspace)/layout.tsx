/**
 * Layout for the gated Leader Workspace. The /admin/login route is OUTSIDE
 * this route group so it doesn't get the workspace chrome.
 *
 * THIS IS WHERE ADMIN ACCESS IS ACTUALLY DECIDED
 * (Plans/Unified-Identity-And-Capabilities.md Phase B). proxy.ts checks
 * signatures only — it runs in the Edge runtime on every request and cannot
 * afford the capability read. This layout runs once per page load and can, so
 * it resolves the actor properly and turns away an identity session that
 * holds no grants.
 *
 * Refusing inline rather than redirecting is deliberate: a verified person
 * with no capabilities has already signed in successfully, so bouncing them
 * to /admin/login would be a loop with no explanation. Same pattern /profile
 * uses to refuse a scout session.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SubNav } from './_components/sub-nav';
import { DirtyGuardProvider } from './_components/dirty-guard';
import { ArticleStyleTokens } from '@/lib/article-body/ArticleStyleTokens';
import { TopBar } from './_components/top-bar';
import { IS_DEV_DB } from '@/lib/dev-db';
import { resolveAdminActor } from '@/lib/admin-actor';
import { CAPABILITIES } from '@/lib/capabilities';
import styles from './admin.module.css';
// Global --admin-* design tokens on :root (Plans/Admin-Design-System.md).
// Must load with the workspace so every admin module and portal resolves them.
import './admin.css';

export const metadata: Metadata = IS_DEV_DB
  ? { title: { template: '[DEV] %s', default: '[DEV] Troop 79 Admin' } }
  : { title: { template: '%s', default: 'Troop 79 Admin' } };

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const actor = await resolveAdminActor();

  // No credential at all, or an identity session whose epoch was bumped
  // (revoked, roster deactivation). The proxy lets a signature-valid cookie
  // through; this is the first place the revocation is actually noticed.
  if (!actor) redirect('/admin/login');

  if (actor.capabilities.size === 0) {
    // NOT wrapped in styles.workspace: that is a two-column grid whose first
    // track is the sub-nav, so a <main> placed in it with no SubNav sibling
    // collapses into a ~120px column. Found in browser verification
    // 2026-08-16. This branch has no nav by design, so it gets its own plain
    // container instead.
    return (
      <div className={styles.adminRoot}>
        <ArticleStyleTokens />
        <TopBar actorLabel={actor.label} actorKind={actor.kind} />
        <main className={styles.plainMain}>
          <h1 className={styles.plainHeading}>No admin access</h1>
          <p>
            You&rsquo;re signed in as <strong>{actor.label}</strong>, but this account hasn&rsquo;t
            been given any admin capabilities. If you think that&rsquo;s wrong, ask a troop leader to
            grant them.
          </p>
          <p className={styles.plainBackRow}>
            <Link href="/">← Back to the troop site</Link>
          </p>
        </main>
      </div>
    );
  }

  // A partially-granted actor now gets a real workspace, not a "come back
  // later" panel — the Advancement section's guards are converted (Phase B2),
  // so `advancement.write` alone is a usable grant. The nav shows only what
  // they can actually reach: converted sections they hold, and nothing else.
  //
  // `fullAdmin` still means "sees the unconverted sections too", because those
  // pages guard with requireRole(), whose identity mapping deliberately admits
  // only a full troop admin (see lib/require-role.ts). It stops being a
  // meaningful distinction when the last call site is converted.
  const fullAdmin = actor.legacyRole !== null || CAPABILITIES.every((c) => actor.capabilities.has(c));

  return (
    <div className={styles.adminRoot}>
      {/* Same typography tokens the public pages get, so the editors' live
          preview panes show what will actually publish rather than the
          stylesheet defaults. */}
      <ArticleStyleTokens />
      <TopBar actorLabel={actor.label} actorKind={actor.kind} />
      <div className={styles.workspace}>
        <SubNav fullAdmin={fullAdmin} capabilities={[...actor.capabilities]} />
        <main className={styles.main}>
          <DirtyGuardProvider>{children}</DirtyGuardProvider>
        </main>
      </div>
      {/* Portal target for admin components (e.g. DatePickerField) that need
          top-level positioning outside their own stacking context. Since the
          --admin-* tokens moved to :root (admin.css, 2026-08-21) this node no
          longer has to sit inside .adminRoot for token inheritance — it stays
          for the stable portal-target contract DatePickerField relies on. */}
      <div id="admin-popover-root" />
    </div>
  );
}
