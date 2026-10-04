/**
 * Menu Monster › Needs attention — the leader tools' first tab (Plans/Menu-Monster-Brands-Gear.md, release 6).
 * One line per kind of thing waiting on a leader, with its count and a link to the tab where it is handled;
 * nothing is decided here. Below it, the brands people typed in lately (they joined the troop's list at once —
 * Patrick, 2026-10-03 — so this is where an adult notices one to rename, merge or remove).
 */
import Link from 'next/link';
import { fmtDate } from '@/lib/format-date';
import { Badge } from '../../_components/badge';
import styles from './menu-monster.module.css';

const HREF = '/admin/library/menu-monster';

export interface AttentionCounts {
  heldPrices: number;
  heldPackages: number;
  ingredients: number;
  editedRecipes: number;
  unpriced: number;
  drafts: number;
  unfinishedOutings: number;
}

export interface NewBrand {
  id: string;
  name: string;
  ingredientId: string;
  ingredientName: string;
  addedBy: string;
  createdAt: string;
  /** Nobody has priced it yet. */
  unpriced: boolean;
}

export function Attention({ counts, brands }: { counts: AttentionCounts; brands: NewBrand[] }) {
  const rows: { n: number; text: string; where: string; href: string }[] = [
    { n: counts.heldPrices, text: counts.heldPrices === 1 ? 'price a scout reported is waiting for a decision' : 'prices scouts reported are waiting for a decision', where: 'Price book', href: `${HREF}?tab=prices` },
    { n: counts.heldPackages, text: counts.heldPackages === 1 ? 'package a scout added is held (its price is far from the troop’s)' : 'packages scouts added are held (their prices are far from the troop’s)', where: 'Price book', href: `${HREF}?tab=prices` },
    { n: counts.ingredients, text: counts.ingredients === 1 ? 'ingredient someone typed in needs matching, keeping or rejecting' : 'ingredients people typed in need matching, keeping or rejecting', where: 'Scout recipes', href: `${HREF}?tab=scouts` },
    { n: counts.editedRecipes, text: counts.editedRecipes === 1 ? 'shared recipe was edited after it was shared' : 'shared recipes were edited after they were shared', where: 'Scout recipes', href: `${HREF}?tab=scouts` },
    { n: counts.unfinishedOutings, text: counts.unfinishedOutings === 1 ? 'past outing has shopping nobody finished recording' : 'past outings have shopping nobody finished recording', where: 'Purchases', href: `${HREF}?tab=purchases` },
    { n: counts.unpriced, text: counts.unpriced === 1 ? 'ingredient has no price' : 'ingredients have no price', where: 'Price book', href: `${HREF}?tab=prices` },
    { n: counts.drafts, text: counts.drafts === 1 ? 'food or recipe is still a draft' : 'foods and recipes are still drafts', where: 'Food & recipes', href: `${HREF}?tab=recipes` }
  ].filter((r) => r.n > 0);

  return (
    <div className={styles.activity}>
      <section className={styles.activitySection} aria-labelledby="mm-attn-head">
        <div className={styles.activityHead}>
          <h2 id="mm-attn-head" className={styles.activityTitle}>
            Waiting on a leader
          </h2>
        </div>
        {rows.length === 0 ? (
          <p className={styles.emptyLine}>Nothing needs you right now.</p>
        ) : (
          <ul className={styles.list} aria-label="Waiting on a leader">
            {rows.map((r) => (
              <li key={r.text} className={styles.listRow}>
                <Badge variant="warning">{r.n}</Badge>
                <span className={styles.grow}>{r.text}</span>
                <Link href={r.href}>{r.where} →</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.activitySection} aria-labelledby="mm-attn-brands">
        <div className={styles.activityHead}>
          <h2 id="mm-attn-brands" className={styles.activityTitle}>
            Brands typed in lately
          </h2>
          <span className={styles.cardMeta}>the last 30 days · already on the troop’s list</span>
        </div>
        {brands.length === 0 ? (
          <p className={styles.emptyLine}>No one has typed in a new brand lately.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Ingredient</th>
                  <th>Typed in by</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`${HREF}?tab=prices&ingredient=${encodeURIComponent(b.ingredientId)}`}>{b.name}</Link>
                      {b.unpriced && (
                        <>
                          {' '}
                          <Badge variant="muted">No price yet</Badge>
                        </>
                      )}
                    </td>
                    <td>{b.ingredientName}</td>
                    <td>{b.addedBy}</td>
                    <td>{fmtDate(b.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
