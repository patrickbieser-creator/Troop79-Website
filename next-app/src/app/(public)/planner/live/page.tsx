/**
 * /planner/live — renamed /planner/rotations (Rotations L3, D-437). Old links and bookmarks land there, query kept.
 */
import { redirect } from 'next/navigation';

export default async function MeetingLiveRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const one of Array.isArray(v) ? v : v == null ? [] : [v]) params.append(k, one);
  const q = params.toString();
  redirect(q ? `/planner/rotations?${q}` : '/planner/rotations');
}
