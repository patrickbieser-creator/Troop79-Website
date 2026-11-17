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
import { Rail, RailMenuButton } from './_components/rail';
import { SearchLauncher } from './_components/search-dialog';
import { searchEntries } from './_components/search-model';
import { DirtyGuardProvider } from './_components/dirty-guard';
import { ArticleStyleTokens } from '@/lib/article-body/ArticleStyleTokens';
import { TopBar } from './_components/top-bar';
import { IS_DEV_DB } from '@/lib/dev-db';
import { actorCanEnterAdmin, resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { loadWreathSaleOpen } from '@/lib/wreaths/admin-data';
import { visibleFeaturesFor } from './_components/nav-visibility';
import { railModel, areaCounts } from './_components/area-menu';
import { loadPinKeys } from './_components/pins-store';
import { attentionCategoriesFor } from './_home/attention-items';
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

  // Same predicate the public account menu uses to offer "Admin".
  if (!actorCanEnterAdmin(actor)) {
    // NOT wrapped in styles.workspace: this branch has no nav by design, so it
    // gets its own plain container instead.
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

  // A partially-granted actor gets a real workspace: the rail offers exactly what they can open, from the feature
  // registry (visibleFeatures), and each page still guards itself. The health viewers list and planner access are
  // folded in by navVisibility.
  const sb = createAdminClient();
  const visible = await visibleFeaturesFor(actor);
  const [wreathOpen, pinKeys] = await Promise.all([
    // Only a treasurer sees the Wreath Sale item, so only they pay for the (one small) select that orders it. A
    // failed read only costs the menu's seasonal ordering.
    visible.some((f) => f.seasonal) ? loadWreathSaleOpen(sb).catch(() => false) : Promise.resolve(false),
    // Pins are personal. A failed read (or the table not there yet) shows the rail without them, never an error.
    actor.personId != null ? loadPinKeys(sb, actor.personId).catch(() => []) : Promise.resolve([])
  ]);
  const rail = railModel(visible, pinKeys, { wreathOpen });
  // The group counts come from the same queries as Needs you today. Not awaited: the rail streams them in.
  // Layouts persist across client navigation, so counts and pins refresh on a full load or after a pin change (the
  // server action revalidates the layout), not on every click.
  const counts = attentionCategoriesFor(actor.capabilities)
    .then(areaCounts)
    .catch(() => ({}));

  return (
    <div className={`${styles.adminRoot} ${styles.workspaceRoot}`}>
      {/* Same typography tokens the public pages get, so the editors' live
          preview panes show what will actually publish rather than the
          stylesheet defaults. */}
      <ArticleStyleTokens />
      <TopBar
        actorLabel={actor.label}
        actorKind={actor.kind}
        menuButton={<RailMenuButton />}
        search={<SearchLauncher entries={searchEntries(visible)} />}
      />
      <div className={styles.workspace}>
        {/* The provider wraps the rail as well as the page, so leaving a dirty form through it asks first. */}
        <DirtyGuardProvider>
          <Rail groups={rail.groups} pins={rail.pins} setup={rail.setup} counts={counts} canPin={actor.personId != null} devDb={IS_DEV_DB} />
          <main className={styles.main}>{children}</main>
        </DirtyGuardProvider>
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
