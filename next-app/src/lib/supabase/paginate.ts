/**
 * Supabase/PostgREST caps unbounded selects at 1000 rows by default —
 * silently, not as an error. Any query that isn't scoped to one scout (or
 * otherwise guaranteed small) needs this once the ledger grows past that,
 * or it quietly sees only a partial slice of the data. Confirmed to have
 * actually happened for the Leader Dashboard's rank-requirement readiness
 * check once `ledger_entries` passed ~5,600 `rank_requirement` rows.
 */

const PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/** Fetches every row for a query, paginating past the 1000-row cap.
 *  `buildQuery` must apply `.range(from, to)` itself and return a fresh
 *  query each call — Supabase query builders aren't reusable across calls. */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}
