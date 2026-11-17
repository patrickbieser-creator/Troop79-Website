/**
 * Home's At a glance (Plans/Completed/Admin-Portal-Nav.md decision 6): Active scouts, Troop account, Missing BSA IDs and
 * Uncollected funds. Its own async component: Home renders it inside Suspense, so the page's top never waits on these
 * reads. Each tile loads on its own (loadGlance) and a tile that can't load says so in place. The money tiles appear
 * only for finance holders, and their loaders never run for anyone else.
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { loadGlance, type Tile } from './home-data';
import styles from './home.module.css';

const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function TileFailed({ label }: { label: string }) {
  return (
    <div className={`${styles.tile} ${styles.tileFailed}`} role="status">
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileError}>Couldn&rsquo;t load. Reload to try again.</span>
    </div>
  );
}

export async function AtAGlance({ financeView, financeManage, canRoster }: { financeView: boolean; financeManage: boolean; canRoster: boolean }) {
  const glance = await loadGlance(createAdminClient(), { financeView, financeManage });
  const people = glance.people;
  return (
    <section aria-labelledby="home-glance" className={styles.block}>
      <h2 id="home-glance" className={styles.heading}>
        At a glance
      </h2>
      <div className={styles.glance}>
        {people.ok ? (
          <div className={styles.tile}>
            <span className={styles.tileLabel}>Active scouts</span>
            <strong className={styles.tileValue}>{people.value.activeScouts}</strong>
          </div>
        ) : (
          <TileFailed label="Active scouts" />
        )}
        {glance.troopFunds ? <TroopFunds tile={glance.troopFunds} /> : null}
        {people.ok ? (
          <MissingBsa scouts={people.value.missingScouts} leaders={people.value.missingLeaders} link={canRoster} />
        ) : (
          <TileFailed label="Missing BSA IDs" />
        )}
        {glance.uncollected ? (
          glance.uncollected.ok ? (
            <div className={styles.tile}>
              <span className={styles.tileLabel}>Uncollected funds</span>
              <strong className={styles.tileValue}>{money(glance.uncollected.value.total)}</strong>
              <span className={styles.tileSub}>
                <Link href="/admin/finance/wreaths?pay=unpaid">Wreath orders {money(glance.uncollected.value.wreaths)}</Link> ·
                Event fees {money(glance.uncollected.value.events)}
              </span>
            </div>
          ) : (
            <TileFailed label="Uncollected funds" />
          )
        ) : null}
      </div>
    </section>
  );
}

function TroopFunds({ tile }: { tile: Tile<number> }) {
  if (!tile.ok) return <TileFailed label="Troop account" />;
  return (
    <Link href="/admin/finance" className={styles.tile}>
      <span className={styles.tileLabel}>Troop account</span>
      <strong className={styles.tileValue}>{money(tile.value)}</strong>
      <span className={styles.tileSub}>Checking and savings</span>
    </Link>
  );
}

function MissingBsa({ scouts, leaders, link }: { scouts: number; leaders: number; link: boolean }) {
  const body = (
    <>
      <span className={styles.tileLabel}>Missing BSA IDs</span>
      <strong className={styles.tileValue}>{scouts + leaders}</strong>
      <span className={styles.tileSub}>
        {plural(scouts, 'scout')} · {plural(leaders, 'leader')}
      </span>
    </>
  );
  return link ? (
    <Link href="/admin/reports/missing-bsa-ids" className={styles.tile}>
      {body}
    </Link>
  ) : (
    <div className={styles.tile}>{body}</div>
  );
}
