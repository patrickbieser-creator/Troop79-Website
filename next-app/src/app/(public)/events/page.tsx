import Link from 'next/link';
import { loadEvents, formatEventDateParts } from '@/lib/news-feed';
import styles from './events.module.css';

export const metadata = { title: 'Events — Troop 79' };

export default async function EventsPage() {
  const { upcoming, past } = await loadEvents();

  return (
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Events</h1>
      <p className={styles.pageSub}>Upcoming troop events. Past events stay listed below for reference.</p>

      <div className={styles.sectionDivider}>
        <span className={styles.divLabel}>Upcoming</span>
        <span className={styles.divRule} aria-hidden="true" />
      </div>
      {upcoming.length === 0 ? (
        <p className={styles.empty}>No upcoming events posted yet.</p>
      ) : (
        <ul className={styles.list}>
          {upcoming.map((ev) => {
            const { month, day } = formatEventDateParts(ev.event_start!);
            return (
              <li key={ev.id} className={styles.item}>
                <div className={styles.dateBlock}>
                  <div className={styles.eMonth}>{month}</div>
                  <div className={styles.eDay}>{day}</div>
                </div>
                <div className={styles.itemBody}>
                  <p className={styles.itemTitle}>
                    <Link href={`/news/${ev.slug}`}>{ev.title}</Link>
                  </p>
                  {ev.event_location && <p className={styles.itemMeta}>{ev.event_location}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {past.length > 0 && (
        <>
          <div className={styles.sectionDivider}>
            <span className={styles.divLabel}>Past Events</span>
            <span className={styles.divRule} aria-hidden="true" />
          </div>
          <ul className={styles.list}>
            {past.map((ev) => {
              const { month, day } = formatEventDateParts(ev.event_start!);
              return (
                <li key={ev.id} className={`${styles.item} ${styles.pastItem}`}>
                  <div className={styles.dateBlock}>
                    <div className={styles.eMonth}>{month}</div>
                    <div className={styles.eDay}>{day}</div>
                  </div>
                  <div className={styles.itemBody}>
                    <p className={styles.itemTitle}>
                      <Link href={`/news/${ev.slug}`}>{ev.title}</Link>
                    </p>
                    {ev.event_location && <p className={styles.itemMeta}>{ev.event_location}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
