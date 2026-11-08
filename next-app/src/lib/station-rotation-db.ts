/**
 * Station rotations, the database side (Plans/Planner-Station-Rotations.md; 20261231999000_station_rotations.sql): a
 * meeting's Stations switch and its station order. Server-only: every function takes the service-role client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MeetingStation {
  /** The focus set topic: 'fg:27'. */
  key: string;
  title: string;
  setId: number | null;
  /** The focus set's time goal (read live from the set, not snapshotted), or null. */
  goalMinutes: number | null;
}

export interface MeetingRotation {
  on: boolean;
  /** In station order. Kept while the switch is off. */
  stations: MeetingStation[];
}

type One<T> = T | T[] | null;
const one = <T>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
type StationRow = {
  position: number;
  meeting_topics: One<{ topic_key: string; title: string | null; focus_set_id: number | null; focus_sets: One<{ goal_minutes: number | null }> }>;
};

export async function loadRotation(sb: SupabaseClient, entryId: number): Promise<MeetingRotation> {
  const [sw, rows] = await Promise.all([
    sb.from('meeting_rotations').select('stations_on').eq('calendar_entry_id', entryId).maybeSingle(),
    sb
      .from('meeting_rotation_stations')
      .select('position, meeting_topics(topic_key, title, focus_set_id, focus_sets(goal_minutes))')
      .eq('calendar_entry_id', entryId)
      .order('position')
  ]);
  if (sw.error) throw new Error(sw.error.message);
  if (rows.error) throw new Error(rows.error.message);
  const stations = ((rows.data ?? []) as unknown as StationRow[]).flatMap((r) => {
    const t = one(r.meeting_topics);
    return t ? [{ key: t.topic_key, title: t.title ?? t.topic_key, setId: t.focus_set_id, goalMinutes: one(t.focus_sets)?.goal_minutes ?? null }] : [];
  });
  return { on: !!(sw.data as { stations_on: boolean } | null)?.stations_on, stations };
}

/** The RPCs' own messages are written for people; anything else is not shown raw. */
const KNOWN = /^(Only a focus set on this meeting|A station is listed twice|That meeting)/;
export type StationWrite = { ok: true } | { ok: false; error: string };
const result = ({ error }: { error: { message: string } | null }): StationWrite =>
  error ? { ok: false, error: KNOWN.test(error.message) ? error.message : 'Couldn’t save that. Try again.' } : { ok: true };

/** Turn Stations on or off. On with no stations yet makes every focus set on the night a station. */
export async function setStations(sb: SupabaseClient, entryId: number, on: boolean): Promise<StationWrite> {
  return result(await sb.rpc('meeting_set_rotation', { p_entry: entryId, p_on: on }));
}

/** Replace the station list with these focus set topics, in this order. */
export async function orderStations(sb: SupabaseClient, entryId: number, keys: readonly string[]): Promise<StationWrite> {
  return result(await sb.rpc('meeting_order_stations', { p_entry: entryId, p_keys: keys }));
}
