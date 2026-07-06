/**
 * Replaces ONE merit badge's requirement tree in Supabase (replace-on-save,
 * same semantics as the Lookups MB editor's updateMeritBadge action). Used by
 * the `populate-mb-requirements` skill to load condensed requirement trees
 * parsed from the official BSA requirement text.
 *
 * Run:  npm run set-mb-reqs -- <path-to-json> [--force]
 *
 * JSON input shape (matches data/advancement.json meritBadgeRequirements nodes):
 *   {
 *     "mbId": "citizenship-community",
 *     "requirements": [
 *       { "code": "1", "label": "...", "complete": "all" },
 *       { "code": "2", "label": "...", "complete": "all", "children": [
 *         { "code": "2a", "label": "..." }
 *       ]},
 *       { "code": "9", "label": "...", "complete": "n-of", "completeN": 2, "children": [...] }
 *     ]
 *   }
 *
 * Safety:
 *   - Badge must already exist in merit_badges (catalog rows are seeded/imported).
 *   - Duplicate codes in the input are rejected.
 *   - If active ledger rows reference a `<mbId>-<code>` whose code is missing
 *     from the new tree, the script aborts (pass --force to override) so
 *     existing sign-offs never silently orphan.
 *
 * Requires local Supabase running (`supabase start` from next-app/) OR a
 * cloud project URL + service role key in .env.local. Uses the SERVICE ROLE
 * key (bypasses RLS) — only run server-side.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Config ────────────────────────────────────────────────────────────────

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error(
    'SUPABASE_SERVICE_ROLE_KEY env var is required (see next-app/.env.local).'
  );
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== '--force');
const force = process.argv.includes('--force');
const inputPath = args[0];

if (!inputPath) {
  console.error('Usage: npm run set-mb-reqs -- <path-to-json> [--force]');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// ── Input ─────────────────────────────────────────────────────────────────

interface ReqNode {
  code: string;
  label: string;
  complete?: 'all' | 'any' | 'n-of';
  completeN?: number;
  children?: ReqNode[];
}

interface Input {
  mbId: string;
  requirements: ReqNode[];
}

const raw = JSON.parse(readFileSync(resolve(inputPath), 'utf8')) as Input;
const { mbId, requirements } = raw;

if (!mbId || !Array.isArray(requirements) || requirements.length === 0) {
  console.error('Input JSON must have { mbId, requirements: [...] }');
  process.exit(1);
}

function collectCodes(nodes: ReqNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    acc.push(n.code);
    if (n.children?.length) collectCodes(n.children, acc);
  }
  return acc;
}

function validate(nodes: ReqNode[]) {
  const codes = collectCodes(nodes);
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dupes.length) {
    console.error(`Duplicate codes in input: ${[...new Set(dupes)].join(', ')}`);
    process.exit(1);
  }
  const walk = (ns: ReqNode[]) => {
    for (const n of ns) {
      if (!n.code?.trim() || !n.label?.trim()) {
        console.error(`Node missing code or label: ${JSON.stringify(n)}`);
        process.exit(1);
      }
      if (n.complete && !['all', 'any', 'n-of'].includes(n.complete)) {
        console.error(`Bad complete rule on ${n.code}: ${n.complete}`);
        process.exit(1);
      }
      if (n.complete === 'n-of' && !n.completeN) {
        console.error(`${n.code} uses n-of but has no completeN`);
        process.exit(1);
      }
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
}

// ── Insert ────────────────────────────────────────────────────────────────

async function insertTree(
  nodes: ReqNode[],
  parentId: number | null
): Promise<number> {
  let count = 0;
  let i = 0;
  for (const node of nodes) {
    const { data, error } = await supabase
      .from('merit_badge_requirements')
      .insert({
        mb_id: mbId,
        parent_id: parentId,
        code: node.code.trim(),
        label: node.label.trim(),
        complete_rule: node.complete ?? 'all',
        complete_n: node.complete === 'n-of' ? (node.completeN ?? null) : null,
        sort_order: i++
      })
      .select('id')
      .single();
    if (error) throw new Error(`insert ${mbId} ${node.code}: ${error.message}`);
    count++;
    if (node.children?.length) count += await insertTree(node.children, data.id);
  }
  return count;
}

async function main() {
  validate(requirements);

  // Badge must exist in the catalog.
  const { data: badge, error: badgeErr } = await supabase
    .from('merit_badges')
    .select('id,name')
    .eq('id', mbId)
    .maybeSingle();
  if (badgeErr) throw new Error(badgeErr.message);
  if (!badge) {
    console.error(
      `Merit badge "${mbId}" not found in merit_badges — add it to the catalog first.`
    );
    process.exit(1);
  }

  // Ledger safety: active sign-offs must still resolve to a code in the new tree.
  const newCodes = new Set(collectCodes(requirements));
  const { data: ledgerRows, error: ledgerErr } = await supabase
    .from('ledger_active')
    .select('code')
    .eq('kind', 'merit_badge_requirement')
    .like('code', `${mbId}-%`);
  if (ledgerErr) throw new Error(ledgerErr.message);
  const orphaned = [
    ...new Set(
      (ledgerRows ?? [])
        .map((r) => r.code.slice(mbId.length + 1))
        .filter((c) => !newCodes.has(c))
    )
  ];
  if (orphaned.length && !force) {
    console.error(
      `Aborting: active ledger rows reference codes missing from the new tree: ` +
        `${orphaned.join(', ')}. Keep those codes, or re-run with --force.`
    );
    process.exit(1);
  }
  if (orphaned.length && force) {
    console.warn(`--force: proceeding despite orphaned ledger codes: ${orphaned.join(', ')}`);
  }

  const { count: oldCount } = await supabase
    .from('merit_badge_requirements')
    .select('id', { count: 'exact', head: true })
    .eq('mb_id', mbId);

  const { error: delErr } = await supabase
    .from('merit_badge_requirements')
    .delete()
    .eq('mb_id', mbId);
  if (delErr) throw new Error(`delete existing: ${delErr.message}`);

  const inserted = await insertTree(requirements, null);
  console.log(
    `${badge.name} (${mbId}): replaced ${oldCount ?? 0} rows with ${inserted}.`
  );
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
