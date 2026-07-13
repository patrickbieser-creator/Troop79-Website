import { loadCalendarEntries, CATEGORIES } from '@/lib/calendar';
import { siteUrl } from '@/lib/site-url';
import { SubscribeCalendar } from './subscribe-calendar';
import { CalendarBrowser } from './calendar-browser';
import styles from './events.module.css';

export const metadata = { title: 'Calendar — Troop 79' };

export default async function EventsPage() {
  const { upcoming, past } = await loadCalendarEntries();
  const icsUrl = `${siteUrl()}/calendar.ics`;
  const webcalUrl = icsUrl.replace(/^https?:\/\//, 'webcal://');

  return (
    <main className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Calendar</h1>
          <p className={styles.pageSub}>
            Everything on the Troop 79 calendar — meetings, campouts, service projects, and more.
          </p>
        </div>
        <SubscribeCalendar icsUrl={icsUrl} webcalUrl={webcalUrl} />
      </div>

      <CalendarBrowser upcoming={upcoming} past={past} categories={CATEGORIES} />
    </main>
  );
}
