/**
 * /meetings — home base: the next upcoming published meeting (or the most
 * recent past one when nothing is scheduled ahead). Permalinks live at
 * /meetings/[date]; this page is the nav tab's landing spot.
 *
 * ISR keeps the "which meeting is current" resolution fresh as days pass;
 * publish/unpublish actions revalidate immediately.
 */

import { centralToday } from '@/lib/dates';
import {
  getPublicMeeting,
  getPublishedMeetingDates,
  resolveDefaultMeetingDate
} from '@/lib/meetings';
import { MeetingView } from './meeting-view';
import styles from './meetings.module.css';

export const revalidate = 1800;

export const metadata = {
  title: 'Meetings — Scout Troop 79',
  description:
    'What’s happening at this week’s Troop 79 meeting — agenda, logistics, and past meeting archives.'
};

export default async function MeetingsPage() {
  const today = centralToday();
  const dates = await getPublishedMeetingDates();
  const current = resolveDefaultMeetingDate(dates, today);

  if (!current) {
    return (
      <>
        <div className={styles.pageHeader}>
          <h1>Meetings</h1>
          <div className={styles.pageHeaderMeta}>
            <span>What&rsquo;s happening at Troop 79 meetings &mdash; this week and past weeks.</span>
          </div>
          <div className={styles.pageHeaderRule} />
        </div>
        <div className={styles.noMeetingWrap}>
          <div className={styles.noMeetingCard}>
            <p className={styles.noMeetingMsg}>
              No meeting agendas have been published yet &mdash; check back soon.
            </p>
          </div>
        </div>
      </>
    );
  }

  const meeting = await getPublicMeeting(current);
  return (
    <MeetingView
      date={current}
      meeting={meeting}
      calendarEntry={null}
      dates={dates}
      defaultDate={current}
      today={today}
    />
  );
}
