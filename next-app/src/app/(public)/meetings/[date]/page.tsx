/**
 * /meetings/[date] — permalink for one meeting. Published dates render the
 * agenda (past ones get an archive banner); dates without a published
 * agenda get a state-aware placeholder backed by the calendar (a real "No
 * Meeting" week says so; a future meeting says "agenda coming").
 */

import { notFound } from 'next/navigation';
import { centralToday, formatLongDate } from '@/lib/dates';
import {
  getCalendarMeetingEntry,
  getPublicMeeting,
  getPublishedMeetingDates,
  resolveDefaultMeetingDate
} from '@/lib/meetings';
import { MeetingView } from '../meeting-view';

export const revalidate = 1800;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!DATE_RE.test(date)) return { title: 'Meetings — Scout Troop 79' };
  return {
    title: `Meeting ${formatLongDate(date)} — Scout Troop 79`,
    description: `Troop 79 meeting agenda for ${formatLongDate(date)}.`
  };
}

export default async function MeetingPermalinkPage({
  params
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const today = centralToday();
  const [dates, meeting] = await Promise.all([getPublishedMeetingDates(), getPublicMeeting(date)]);
  const calendarEntry = meeting ? null : await getCalendarMeetingEntry(date);

  return (
    <MeetingView
      date={date}
      meeting={meeting}
      calendarEntry={calendarEntry}
      dates={dates}
      defaultDate={resolveDefaultMeetingDate(dates, today)}
      today={today}
    />
  );
}
