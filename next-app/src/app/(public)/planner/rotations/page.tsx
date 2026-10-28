/** Retired by Meeting Planner III (Plans/Meeting-Planner-III.md): old links land on This week, the meeting kept. */
import { redirect } from 'next/navigation';

export default async function Retired({ searchParams }: { searchParams: Promise<{ meeting?: string | string[] }> }) {
  const m = (await searchParams).meeting;
  const id = Array.isArray(m) ? m[0] : m;
  redirect(id && /^\d{1,18}$/.test(id) ? `/planner?meeting=${id}` : '/planner');
}
