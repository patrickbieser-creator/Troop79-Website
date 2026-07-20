/**
 * Seeds the REFERENCE TAXONOMY into Supabase: leaders, activity types,
 * ranks + rank requirement trees, the merit-badge catalog + sub-requirement
 * trees. Read from the prototype's `data/advancement.json`, which is the
 * canonical source for these BSA-aligned reference tables.
 *
 * Does NOT seed scouts, ledger entries, or COH history. Those come from the
 * spreadsheet importer (`npm run import-spreadsheet`).
 *
 * Run:  npm run seed
 *
 * Requires local Supabase running (`supabase start` from next-app/) OR a
 * cloud project URL + service role key in .env.local. Uses the SERVICE ROLE
 * key (bypasses RLS) — only run server-side.
 *
 * Safe to re-run: truncates the reference tables before re-inserting. The
 * importer's scouts + ledger data is untouched.
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
    'SUPABASE_SERVICE_ROLE_KEY env var is required.\n' +
      '  - Local dev:  run `supabase start`, then copy the service_role key from its output.\n' +
      '  - Cloud:      grab it from Project Settings → API in the Supabase dashboard.\n' +
      '  Add it to next-app/.env.local'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// ── Load prototype JSON ───────────────────────────────────────────────────

const dataPath = resolve(__dirname, '..', '..', 'data', 'advancement.json');
const RAW = JSON.parse(readFileSync(dataPath, 'utf8'));

// ── Prototype JSON shapes (data/advancement.json) ───────────────────────────

interface RawLeader {
  code: string;
  name: string;
  role?: string | null;
}
interface RawActivityType {
  id: string;
  label: string;
}
interface RawRank {
  id: string;
  displayName: string;
  color?: string | null;
}
interface RawReqNode {
  code: string;
  label: string;
  complete?: string;
  completeN?: number | null;
  children?: RawReqNode[];
}

// ── Truncate (reference tables only) ──────────────────────────────────────

async function truncateReqTrees() {
  // Only the requirement trees get truncated — those are pure derived data
  // with no inbound FKs from production tables. ranks, activity_types,
  // leaders, merit_badges are upserted so existing FKs (e.g. scouts.current_rank)
  // and importer-added merit_badges keep working.
  for (const t of ['merit_badge_requirements', 'rank_requirements']) {
    const { error } = await supabase.from(t).delete().not('id', 'is', null);
    if (error) throw new Error(`truncate ${t}: ${error.message}`);
  }
}

// ── Inserters ─────────────────────────────────────────────────────────────

async function seedLeaders() {
  const rows = (RAW.leaders ?? []).map((l: RawLeader) => ({
    code: l.code,
    name: l.name,
    role: l.role ?? null
  }));
  if (!rows.length) return;
  const { error } = await supabase.from('leaders').upsert(rows, { onConflict: 'code' });
  if (error) throw new Error('leaders: ' + error.message);
  console.log(`  · ${rows.length} leaders upserted`);
}

async function seedActivityTypes() {
  const rows = (RAW.activityTypes ?? []).map((a: RawActivityType) => ({
    id: a.id,
    label: a.label
  }));
  if (!rows.length) return;
  const { error } = await supabase.from('activity_types').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error('activity_types: ' + error.message);
  console.log(`  · ${rows.length} activity types upserted`);
}

async function seedRanks() {
  const rows = (RAW.ranks ?? []).map((r: RawRank, i: number) => ({
    id: r.id,
    display_name: r.displayName,
    color: r.color ?? null,
    sort_order: i
  }));
  if (!rows.length) return;
  const { error } = await supabase.from('ranks').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error('ranks: ' + error.message);
  console.log(`  · ${rows.length} ranks upserted`);
}

async function seedRankRequirements() {
  let total = 0;
  for (const rank of RAW.ranks ?? []) {
    let i = 0;
    for (const req of rank.requirements ?? []) {
      const { data, error } = await supabase
        .from('rank_requirements')
        .insert({
          rank_id: rank.id,
          parent_id: null,
          code: req.code,
          label: req.label,
          complete_rule: req.complete ?? 'all',
          complete_n: req.completeN ?? null,
          sort_order: i++
        })
        .select('id')
        .single();
      if (error) throw new Error(`rank_req ${rank.id}/${req.code}: ${error.message}`);
      total++;
      let j = 0;
      for (const sub of req.subRequirements ?? []) {
        const subCode = sub.code ?? `${req.code}.${j + 1}`;
        const { error: e2 } = await supabase.from('rank_requirements').insert({
          rank_id: rank.id,
          parent_id: data.id,
          code: subCode,
          label: sub.label,
          complete_rule: sub.complete ?? 'all',
          complete_n: sub.completeN ?? null,
          sort_order: j++
        });
        if (e2) throw new Error(`rank_sub_req ${rank.id}/${subCode}: ${e2.message}`);
        total++;
      }
    }
  }
  console.log(`  · ${total} rank requirements`);
}

async function seedMeritBadges() {
  // Upsert without clobbering: only write fields the JSON catalog actually
  // has values for. Importantly, we DON'T null out scoutbook_id / bsa_page_url
  // / workbook_url that the spreadsheet importer or hand-edits may have
  // already populated.
  const catalog = (RAW.meritBadgeCatalog ?? []) as Array<{
    id: string;
    name: string;
    eagle?: boolean;
    scoutbookId?: string | null;
    bsaPageUrl?: string | null;
    workbookUrl?: string | null;
  }>;
  if (!catalog.length) return;
  let inserted = 0;
  let updated = 0;
  for (const mb of catalog) {
    const { data: existing } = await supabase
      .from('merit_badges')
      .select('id')
      .eq('id', mb.id)
      .maybeSingle();
    if (existing) {
      // Only update the always-known fields (name, eagle). Leave scoutbook_id
      // and link URLs alone so importer/hand-edits aren't clobbered.
      const { error } = await supabase
        .from('merit_badges')
        .update({ name: mb.name, eagle: !!mb.eagle })
        .eq('id', mb.id);
      if (error) throw new Error(`merit_badges update ${mb.id}: ${error.message}`);
      updated++;
    } else {
      const { error } = await supabase.from('merit_badges').insert({
        id: mb.id,
        name: mb.name,
        eagle: !!mb.eagle,
        scoutbook_id: mb.scoutbookId ?? null,
        bsa_page_url: mb.bsaPageUrl ?? null,
        workbook_url: mb.workbookUrl ?? null
      });
      if (error) throw new Error(`merit_badges insert ${mb.id}: ${error.message}`);
      inserted++;
    }
  }
  console.log(`  · ${inserted + updated} merit badges (${inserted} inserted, ${updated} updated)`);
}

async function insertMbReqTree(
  mbId: string,
  nodes: RawReqNode[],
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
        code: node.code,
        label: node.label,
        complete_rule: node.complete ?? 'all',
        complete_n: node.completeN ?? null,
        sort_order: i++
      })
      .select('id')
      .single();
    if (error) throw new Error(`mb_req ${mbId}/${node.code}: ${error.message}`);
    count++;
    if (node.children?.length) {
      count += await insertMbReqTree(mbId, node.children, data.id);
    }
  }
  return count;
}

async function seedMeritBadgeRequirements() {
  let total = 0;
  const map = RAW.meritBadgeRequirements ?? {};
  for (const mbId of Object.keys(map)) {
    if (mbId.startsWith('_')) continue; // skip _note metadata
    const tree = map[mbId];
    if (!Array.isArray(tree)) continue;
    total += await insertMbReqTree(mbId, tree, null);
  }
  console.log(`  · ${total} merit badge requirements`);
}

// ── Run ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding Troop 79 reference taxonomy from data/advancement.json …');
  console.log(`  Supabase: ${SUPABASE_URL}\n`);

  console.log('Truncating requirement trees (leaves catalogs, scouts, ledger alone) …');
  await truncateReqTrees();

  console.log('Inserting …');
  await seedLeaders();
  await seedActivityTypes();
  await seedRanks();
  await seedRankRequirements();
  await seedMeritBadges();
  await seedMeritBadgeRequirements();

  console.log('\nDone.');
  console.log('Next: `npm run import-spreadsheet -- --xlsx="..." --apply` to load scouts + ledger.');
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
