import { loadAllCalendarEntries } from '@/lib/calendar';
import { buildCalendar, type IcsEvent } from '@/lib/ics';

// Regenerate at most every 30 minutes — plenty fresh for a troop calendar,
// and matches the interval Google/Outlook themselves poll subscribed feeds at.
export const revalidate = 1800;

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
}

export async function GET() {
  const base = siteUrl();
  let uidHost = 'troop79.local';
  try {
    uidHost = new URL(base).hostname;
  } catch {
    // keep fallback — NEXT_PUBLIC_SITE_URL is malformed or unset
  }

  const entries = await loadAllCalendarEntries();
  const events: IcsEvent[] = entries.map((e) => ({
    uid: `calendar-entry-${e.id}@${uidHost}`,
    startDate: e.entry_date,
    endDate: e.end_date,
    startTime: e.start_time,
    endTime: e.end_time,
    summary: e.title,
    description: e.description,
    location: e.location,
    url: e.articleSlug ? `${base}/news/${e.articleSlug}` : null
  }));

  const body = buildCalendar({
    calendarName: 'Troop 79 Bugle Calendar',
    timeZoneId: 'America/Chicago',
    events
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="troop79-calendar.ics"',
      'Cache-Control': 'public, max-age=1800'
    }
  });
}
