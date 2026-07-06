/**
 * Shared shape every audit check returns, so the page can run an arbitrary
 * list of checks and render each with the same section/card UI. Add a new
 * check by dropping a `run(supabase): Promise<Finding[]>` module in
 * `checks/` and wiring it into `page.tsx` — no UI changes needed.
 */

export interface MissingLeaf {
  code: string; // full ledger code, e.g. "tenderfoot-4a.3" or "second-class-1a"
  shortCode: string; // "4a.3" or "1a"
  label: string;
  parentCode: string | null; // set when this leaf is a child of a grouped requirement
  parentLabel: string | null;
}

export interface Finding {
  checkId: string;
  scoutId: string;
  scoutName: string;
  groupLabel: string; // e.g. the rank's display name
  contextLine: string; // pre-formatted per-check context, e.g. "BoR on record 3/12/2025 · LMP"
  missing: MissingLeaf[];
}
