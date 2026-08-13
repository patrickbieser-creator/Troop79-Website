import { loadCalendarEntries, loadCalendarCategories } from '@/lib/calendar';
import { siteUrl } from '@/lib/site-url';
import { SubscribeCalendar } from './subscribe-calendar';
import { CalendarBrowser } from './calendar-browser';
import styles from './events.module.css';

export const metadata = { title: 'Calendar — Troop 79' };

/**
 * Re-render at most every 30 minutes (matching /photos and /meetings).
 *
 * This page was fully static with no revalidate, which meant its HTML was
 * whatever the last BUILD produced and nothing but a deploy — or an admin
 * action calling revalidatePath('/events') — could refresh it. That bit on
 * 2026-08-12: the calendar_categories migration (D-082) reached production
 * after the code did, so the page was baked with an empty category list, and
 * it stayed that way (empty filter, every category grey) through the next
 * deploy, because the route's module graph hadn't changed and the prerender
 * carried over. On-demand revalidation from admin still applies and is still
 * the fast path; this is the floor under it for data that changes outside the
 * app, which a migration does.
 */
export const revalidate = 1800;

export default async function EventsPage() {
  const [{ upcoming, past }, categories] = await Promise.all([
    loadCalendarEntries(),
    loadCalendarCategories()
  ]);
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

      <CalendarBrowser upcoming={upcoming} past={past} categories={categories} />
    </main>
  );
}
