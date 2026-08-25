/**
 * /admin/rosters — the Event Management chase-list, retired 2026-08-25
 * (Patrick: "remove the event management from the admin"). The Calendar is
 * the hub: the S pill and Going column carry what this list summarised, and
 * an event's Roster, Money, Snapshot and assignment pages (still under
 * /admin/rosters/[id]) open from the entry's Signup tab. Bookmarks land on
 * the Calendar.
 */

import { redirect } from 'next/navigation';

export default function EventManagementRedirect() {
  redirect('/admin/calendar');
}
