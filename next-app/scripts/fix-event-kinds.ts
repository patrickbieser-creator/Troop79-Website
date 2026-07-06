/**
 * One-off data cleanup: reclassifies the "Pancake Breakfast" ledger rows that
 * were mistakenly logged as `camping_nights` (2 "nights") through Fast
 * Entry's Events tab, back when there was no way to tag an event as a
 * fundraiser instead of a campout. Reclassifies them to `attendance`
 * (qty 1, unit "event") and tags them with the Fundraiser event_type.
 *
 * Dry-run by default — prints every row it would change and its before/after
 * values. Pass --commit to actually write.
 *
 * Run:  npx tsx --env-file=.env.local scripts/fix-event-kinds.ts [--commit]
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error(
    'SUPABASE_SERVICE_ROLE_KEY env var is required (see next-app/.env.local).'
  );
  process.exit(1);
}

const COMMIT = process.argv.includes('--commit');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  const { data: eventType, error: etErr } = await supabase
    .from('event_types')
    .select('id, name')
    .eq('name', 'Fundraiser')
    .maybeSingle();
  if (etErr || !eventType) {
    console.error('Could not find the "Fundraiser" event_types row:', etErr?.message);
    process.exit(1);
  }

  const { data: rows, error } = await supabase
    .from('ledger_entries')
    .select('id, scout_id, kind, code, label, qty, unit, event_type_id')
    .eq('kind', 'camping_nights')
    .is('deleted_at', null)
    .ilike('label', '%pancake breakfast%');
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log('No matching rows found — nothing to do.');
    return;
  }

  console.log(`Found ${rows.length} row(s) to reclassify:\n`);
  const byLabel = new Map<string, number>();
  for (const r of rows) byLabel.set(r.label ?? '', (byLabel.get(r.label ?? '') ?? 0) + 1);
  for (const [label, count] of byLabel) {
    console.log(`  ${count.toString().padStart(3)}  "${label}"`);
  }
  console.log(
    `\nFor each: kind camping_nights → attendance, qty 2 → 1, unit nights → event, event_type_id → ${eventType.id} (Fundraiser).`
  );

  if (!COMMIT) {
    console.log('\nDry run only — pass --commit to apply.');
    return;
  }

  const ids = rows.map((r) => r.id);
  const { error: updErr, count } = await supabase
    .from('ledger_entries')
    .update(
      {
        kind: 'attendance',
        qty: 1,
        unit: 'event',
        event_type_id: eventType.id
      },
      { count: 'exact' }
    )
    .in('id', ids);
  if (updErr) {
    console.error('Update failed:', updErr.message);
    process.exit(1);
  }
  console.log(`\nUpdated ${count ?? ids.length} row(s).`);
}

main();
