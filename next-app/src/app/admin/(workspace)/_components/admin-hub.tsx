/**
 * Home's card grid (Plans/Admin-Home-And-Nav.md Wave 2, Brad's prototype). Presentational only — the groups come from
 * hubGroups() in nav-data, which builds them from the same visible sections the rail renders, so there is no second
 * list to keep. Cards carry a title, one line and a link; no count badges (the inbox above already shows counts).
 * A card whose title is a link also stretches it over the whole card, except where quiet links sit inside (Reports),
 * which stay clickable above it. The quiet "Troop admin tools" group is one card of plain links, last.
 */
import Link from 'next/link';
import type { HubGroup, HubCard } from './nav-data';
import styles from './admin-hub.module.css';

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function Card({ card }: { card: HubCard }) {
  const cls = `${styles.card} ${card.season === 'off' ? styles.off : ''}`;
  return (
    <div className={cls}>
      <Link href={card.href} className={styles.title}>
        {card.title}
      </Link>
      {card.description && <div className={styles.line}>{card.description}</div>}
      {card.links && (
        <ul className={styles.kids}>
          {card.links.map((l) => (
            <li key={l.href}>
              <Link href={l.href}>{l.label}</Link>
            </li>
          ))}
        </ul>
      )}
      {card.season && (
        <span className={`${styles.season} ${card.season === 'open' ? styles.seasonOpen : styles.seasonOff}`}>
          {card.season === 'open' ? 'Sale open' : 'Sale not open'}
        </span>
      )}
    </div>
  );
}

export function AdminHub({ groups }: { groups: HubGroup[] }) {
  return (
    <>
      {groups.map((g) => {
        const id = `hub-${slug(g.title)}`;
        if (g.quiet) {
          const card = g.cards[0];
          return (
            <section key={g.title} className={styles.tools} aria-labelledby={id}>
              <h2 id={id} className={styles.toolsHead}>
                {g.title}
              </h2>
              <ul className={styles.toolsLinks}>
                {card.links!.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        }
        return (
          <section key={g.title} className={styles.group} aria-labelledby={id}>
            <h2 id={id} className={styles.head}>
              {g.title}
            </h2>
            <div className={styles.grid}>
              {g.cards.map((c) => (
                <Card key={c.key} card={c} />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
