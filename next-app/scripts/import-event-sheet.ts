/**
 * Import one tab of the campout workbook as a full event
 * (Plans/Event-Logistics.md §F): calendar entry → signup (prices, car sets,
 * the Patrols/Tents presets, the two leader-only columns, a fee milestone) →
 * one entry per matched person (seats incl. driver, ride status) → car and
 * patrol placements through place_in_group → payments / expenses /
 * reimbursement requests, every money row tagged with an import batch.
 *
 * Run (dry run prints the plan and writes nothing):
 *   npm run import-event-sheet -- "<xlsx>" "<tab>" --date=2026-09-01
 *   npm run import-event-sheet -- "<xlsx>" "<tab>" --date=2026-09-01 --apply
 *   npm run import-event-sheet -- "<xlsx>" "<tab>" --rollback
 *
 * Options:
 *   --date=YYYY-MM-DD   event date (required for --apply); end = date + 2
 *   --title="…"         calendar title (default: the tab's A1 title, cleaned)
 *   --paid-on=YYYY-MM-DD  date on the payment rows (default: date − 10 days)
 *   --no-milestone      skip the synthetic "fee due" payment milestone
 *   --allow-remote      permit a non-localhost Supabase URL (production!)
 *
 * SAFETY
 *   - Refuses any NEXT_PUBLIC_SUPABASE_URL that is not 127.0.0.1 / localhost
 *     unless --allow-remote. The Phase 5 production run also needs the
 *     existing-transaction LINKING pass (§F) + qa-lead review — neither is
 *     built; today this script INSERTS money rows, which is right for a dev
 *     practice copy and wrong against a ledger that already holds them.
 *   - Name matching is exact normalized first+last (the roster-import rule —
 *     no fuzzy matching) plus NAME_ALIASES below for known sheet spellings.
 *   - Everything it writes hangs off one calendar entry whose description
 *     carries the batch marker; --rollback deletes that entry (cascade),
 *     every financial_transactions / reimbursement_requests row linked to it,
 *     and reports the counts. Re-running --apply on an existing batch stops.
 */

import * as XLSX from 'xlsx';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildImportPlan,
  parseEventSheet,
  type ImportPlan,
  type ParsedEventSheet,
  type ResolvedPerson,
  type SheetRow
} from '../src/lib/event-sheet-import';
import { presetSetsFor } from '../src/lib/group-sets';
import { LEADER_PRESETS } from '../src/lib/leader-columns';

// ── args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3).replace(/^"|"$/g, '') : undefined;
};
const positional = args.filter((a) => !a.startsWith('--'));
const [xlsxPath, tabName] = positional;
const APPLY = flag('apply');
const ROLLBACK = flag('rollback');
const eventDate = opt('date');
const titleOverride = opt('title');
const paidOnOpt = opt('paid-on');

if (!xlsxPath || !tabName) {
  console.error('usage: import-event-sheet <xlsx> <tab> --date=YYYY-MM-DD [--title=…] [--apply | --rollback]');
  process.exit(2);
}
if (APPLY && ROLLBACK) {
  console.error('--apply and --rollback are exclusive');
  process.exit(2);
}
if (APPLY && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate ?? '')) {
  console.error('--apply needs --date=YYYY-MM-DD');
  process.exit(2);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required (run via npm script so .env.local loads).');
  process.exit(2);
}
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(SUPABASE_URL);
if (!isLocal && !flag('allow-remote')) {
  console.error(`Refusing: ${SUPABASE_URL} is not the local dev database. Pass --allow-remote only for a reviewed production run.`);
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Known sheet spellings of roster names — exact substitutions, never fuzzy.
const NAME_ALIASES: Record<string, string> = {
  'lilly porter': 'lily porter'
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const BATCH = `event-sheet-${slug(tabName)}`;
const MARKER = `[import_batch=${BATCH}]`;
const ENTERED_BY = 'import:event-sheet';

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const die = (msg: string): never => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};
const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) die(`${what}: ${r.error.message}`);
  if (r.data == null) die(`${what}: no row returned`);
  return r.data as T;
};
/** Like must(), but a missing row is a legitimate answer (maybeSingle lookups). */
const maybe = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T | null => {
  if (r.error) die(`${what}: ${r.error.message}`);
  return r.data;
};

// ── read the tab ─────────────────────────────────────────────────────────
function readTab(): ParsedEventSheet {
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[tabName];
  if (!ws) die(`Tab "${tabName}" not found. Tabs: ${wb.SheetNames.join(' | ')}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as SheetRow[];
  return parseEventSheet(rows);
}

// ── resolve people (exact normalized name, aliases applied) ──────────────
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

async function resolvePeople(parsed: ParsedEventSheet): Promise<{ resolved: ResolvedPerson[]; unmatched: string[] }> {
  type PersonRow = { id: number; first_name: string; last_name: string; display_name: string; merged_into_person_id: number | null };
  const people = must(
    await supabase.from('people').select('id, first_name, last_name, display_name, merged_into_person_id').is('merged_into_person_id', null).limit(5000),
    'people'
  ) as PersonRow[];
  const byName = new Map<string, PersonRow[]>();
  for (const p of people) {
    const k = norm(`${p.first_name} ${p.last_name}`);
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  const ids = people.map((p) => p.id);
  // Any scouts row makes a scout — an inactive one is still a scout on a
  // historical tab, just reported so the leader knows.
  const scouts = must(await supabase.from('scouts').select('person_id, active').in('person_id', ids), 'scouts') as { person_id: number; active: boolean }[];
  const scoutIds = new Set(scouts.map((s) => s.person_id));
  const inactiveScoutIds = new Set(scouts.filter((s) => !s.active).map((s) => s.person_id));
  const hm = must(await supabase.from('household_members').select('person_id, household_id').in('person_id', ids), 'household_members') as {
    person_id: number;
    household_id: number;
  }[];
  const household = new Map(hm.map((h) => [h.person_id, h.household_id]));

  const resolved: ResolvedPerson[] = [];
  const unmatched: string[] = [];
  for (const sp of parsed.people) {
    let key = norm(`${sp.firstName} ${sp.lastName}`);
    key = NAME_ALIASES[key] ?? key;
    const hits = byName.get(key) ?? [];
    if (hits.length !== 1) {
      unmatched.push(`${sp.firstName} ${sp.lastName}${hits.length > 1 ? ' (ambiguous)' : ''}`);
      continue;
    }
    const p = hits[0];
    if (inactiveScoutIds.has(p.id)) console.log(`  note: ${p.display_name} is an inactive scout on the roster — imported as a scout anyway`);
    resolved.push({
      row: sp.row,
      personId: p.id,
      displayName: p.display_name,
      isScout: scoutIds.has(p.id),
      householdId: household.get(p.id) ?? null
    });
  }
  return { resolved, unmatched };
}

// ── rollback ─────────────────────────────────────────────────────────────
async function findBatchEntries(): Promise<{ id: number; title: string }[]> {
  return must(await supabase.from('calendar_entries').select('id, title').like('description', `%${MARKER}%`), 'calendar_entries') as {
    id: number;
    title: string;
  }[];
}

async function rollback(): Promise<void> {
  const cals = await findBatchEntries();
  if (cals.length === 0) {
    console.log(`Nothing to roll back — no calendar entry carries ${MARKER}.`);
    return;
  }
  for (const cal of cals) {
    console.log(`Rolling back "${cal.title}" (calendar_entries.id=${cal.id})…`);
    const sig = maybe(await supabase.from('event_signups').select('id').eq('calendar_entry_id', cal.id).maybeSingle(), 'event_signups') as { id: number } | null;
    const entryIds = sig
      ? ((must(await supabase.from('signup_entries').select('id').eq('event_signup_id', sig.id), 'signup_entries') as { id: number }[]).map((e) => e.id))
      : [];
    const del = async (table: string, build: (q: ReturnType<SupabaseClient['from']>) => PromiseLike<{ count: number | null; error: { message: string } | null }>, what: string) => {
      const r = await build(supabase.from(table));
      if (r.error) die(`${what}: ${r.error.message}`);
      console.log(`  − ${what}: ${r.count ?? 0}`);
    };
    await del('financial_transactions', (q) => q.delete({ count: 'exact' }).eq('import_batch', BATCH), 'batch-tagged transactions');
    await del('financial_transactions', (q) => q.delete({ count: 'exact' }).eq('calendar_entry_id', cal.id), 'other transactions linked to the event');
    if (entryIds.length) {
      await del('financial_transactions', (q) => q.delete({ count: 'exact' }).in('signup_entry_id', entryIds), 'transactions linked to its entries');
    }
    // Reimbursement payouts reference the request; clear them before the requests.
    const reqs = must(await supabase.from('reimbursement_requests').select('id').eq('calendar_entry_id', cal.id), 'reimbursement_requests') as { id: number }[];
    if (reqs.length) {
      await del('financial_transactions', (q) => q.delete({ count: 'exact' }).in('reimbursement_id', reqs.map((r) => r.id)), 'reimbursement payouts');
    }
    await del('reimbursement_requests', (q) => q.delete({ count: 'exact' }).eq('calendar_entry_id', cal.id), 'reimbursement requests');
    await del('event_attendance', (q) => q.delete({ count: 'exact' }).eq('calendar_entry_id', cal.id), 'attendance rows');
    await del('event_signups', (q) => q.delete({ count: 'exact' }).eq('calendar_entry_id', cal.id), 'signup (cascades sets, groups, entries, answers, milestones, prices, questions)');
    await del('calendar_entries', (q) => q.delete({ count: 'exact' }).eq('id', cal.id), 'calendar entry');
  }
  console.log('✓ rolled back');
}

// ── apply ────────────────────────────────────────────────────────────────
async function apply(parsed: ParsedEventSheet, resolved: ResolvedPerson[], plan: ImportPlan): Promise<void> {
  const date = eventDate as string;
  const title = titleOverride ?? parsed.title ?? tabName;
  const paidOn = paidOnOpt ?? addDays(date, -10);

  if ((await findBatchEntries()).length > 0) die(`A calendar entry already carries ${MARKER} — run --rollback first.`);

  // 1. calendar entry
  const cal = must(
    await supabase
      .from('calendar_entries')
      .insert({
        title,
        entry_date: date,
        end_date: addDays(date, 2),
        start_time: '18:00:00',
        end_time: '13:30:00',
        category: 'Campout / Overnight',
        status: 'published',
        on_calendar: true,
        show_on_homepage: false,
        featured: false,
        description: `Imported from the event sheet tab "${tabName}" for practice. ${MARKER}`
      })
      .select('id')
      .single(),
    'calendar_entries insert'
  ) as { id: number };
  console.log(`✓ calendar entry #${cal.id} "${title}" ${date}`);

  // 2. signup (drivers_needed ⇒ the trigger creates both car sets)
  const sig = must(
    await supabase
      .from('event_signups')
      .insert({
        calendar_entry_id: cal.id,
        status: 'open',
        deadline: `${addDays(date, -3)}T23:00:00-05:00`,
        attendance_enabled: true,
        drivers_needed: true,
        audience: 'both',
        payment_instructions: 'Venmo or PayPal to Patrick.',
        needs_permission_slip: true
      })
      .select('id')
      .single(),
    'event_signups insert'
  ) as { id: number };
  console.log(`✓ signup #${sig.id}`);

  // 3. price, sets, leader columns, milestone
  let priceId: number | null = null;
  if (plan.price != null) {
    const price = must(
      await supabase
        .from('event_prices')
        .insert({ event_signup_id: sig.id, label: 'Everyone', amount: plan.price, per: 'event', applies_to: 'both', sort: 0 })
        .select('id')
        .single(),
      'event_prices insert'
    ) as { id: number };
    priceId = price.id;
    console.log(`✓ price "Everyone" $${plan.price}`);
  }

  // The campout presets (Patrols seeds from the roster, Tents self-select) plus
  // any grouping column the sheet has that the preset does not.
  const wanted = presetSetsFor('Campout / Overnight');
  for (const g of parsed.groupSets) {
    if (!wanted.some((w) => w.label.toLowerCase() === g.label.toLowerCase())) {
      wanted.push({ kind: g.kind, label: g.label, seedFromRoster: false, selfSelect: false, familyVisible: true, defaultCapacity: null });
    }
  }
  const setIdByLabel = new Map<string, number>();
  let sort = 10;
  for (const w of wanted) {
    const set = must(
      await supabase
        .from('signup_group_sets')
        .insert({
          event_signup_id: sig.id,
          kind: w.kind,
          label: w.label,
          seed_from_roster: w.seedFromRoster,
          self_select: w.selfSelect,
          family_visible: w.familyVisible,
          default_capacity: w.defaultCapacity,
          sort: sort++
        })
        .select('id')
        .single(),
      `signup_group_sets insert (${w.label})`
    ) as { id: number };
    setIdByLabel.set(w.label, set.id);
  }
  const carSets = must(await supabase.from('signup_group_sets').select('id, label').eq('event_signup_id', sig.id).eq('kind', 'car'), 'car sets') as {
    id: number;
    label: string;
  }[];
  for (const c of carSets) setIdByLabel.set(c.label, c.id);
  console.log(`✓ sets: ${[...setIdByLabel.keys()].join(', ')}`);

  for (const p of LEADER_PRESETS) {
    must(
      await supabase
        .from('signup_questions')
        .insert({ event_signup_id: sig.id, prompt: p.prompt, input_type: 'choice', choices: ['Yes'], applies_to: p.appliesTo, required: false, leader_only: true, print_allowed: true, sort: 0 })
        .select('id')
        .single(),
      `leader column (${p.prompt})`
    );
  }
  console.log(`✓ leader-only columns: ${LEADER_PRESETS.map((p) => p.prompt).join(', ')}`);

  if (!flag('no-milestone') && plan.price != null) {
    must(
      await supabase
        .from('event_milestones')
        .insert({ event_signup_id: sig.id, kind: 'payment', label: 'Campout fee', due_on: paidOn, amount: plan.price, applies_to: 'both', sort: 0 })
        .select('id')
        .single(),
      'event_milestones insert'
    );
    console.log(`✓ milestone: Campout fee $${plan.price} by ${paidOn}`);
  }

  // 4. entries — drivers' cars appear via the sync trigger; patrol seeding
  // runs per entry (roster patrols) and is then overridden by the sheet.
  const entryIdByRow = new Map<number, number>();
  for (const e of plan.entries) {
    const row = must(
      await supabase
        .from('signup_entries')
        .insert({
          event_signup_id: sig.id,
          person_id: e.personId,
          person_kind: e.personKind,
          participant_class: e.participantClass,
          household_id: e.householdId,
          status: 'yes',
          participation: 'full',
          price_id: priceId,
          drives_out: e.drivesOut,
          drives_back: e.drivesBack,
          vehicle_seats_out: e.vehicleSeatsOut,
          vehicle_seats_back: e.vehicleSeatsBack,
          ride_out: e.rideOut,
          ride_back: e.rideBack,
          notes: e.notes,
          entered_by: ENTERED_BY
        })
        .select('id')
        .single(),
      `signup_entries insert (${e.displayName})`
    ) as { id: number };
    entryIdByRow.set(e.row, row.id);
  }
  console.log(`✓ ${plan.entries.length} entries`);

  // 5. placements via the RPC (locks, capacity, moves a seeded placement)
  let placed = 0;
  const outcomes: string[] = [];
  for (const pl of plan.placements) {
    const entryId = entryIdByRow.get(pl.row);
    const setId = setIdByLabel.get(pl.setLabel);
    if (!entryId || !setId) {
      outcomes.push(`row ${pl.row + 1}: no ${pl.setLabel} set/entry — skipped`);
      continue;
    }
    let groupId: number | null = null;
    if (pl.driverRow != null) {
      const driverEntry = entryIdByRow.get(pl.driverRow);
      const g = maybe(
        await supabase.from('signup_groups').select('id').eq('set_id', setId).eq('driver_entry_id', driverEntry ?? -1).maybeSingle(),
        'car lookup'
      ) as { id: number } | null;
      groupId = g?.id ?? null;
    } else if (pl.groupName) {
      const existing = maybe(
        await supabase.from('signup_groups').select('id').eq('set_id', setId).eq('name', pl.groupName).is('driver_entry_id', null).maybeSingle(),
        'group lookup'
      ) as { id: number } | null;
      if (existing) groupId = existing.id;
      else {
        const g = must(
          await supabase.from('signup_groups').insert({ set_id: setId, name: pl.groupName, capacity: null }).select('id').single(),
          `signup_groups insert (${pl.groupName})`
        ) as { id: number };
        groupId = g.id;
      }
    }
    if (groupId == null) {
      outcomes.push(`row ${pl.row + 1}: ${pl.setLabel} group not found — skipped`);
      continue;
    }
    const r = await supabase.rpc('place_in_group', { p_group_id: groupId, p_entry_id: entryId, p_actor: ENTERED_BY });
    if (r.error) outcomes.push(`row ${pl.row + 1}: ${pl.setLabel} → ${r.error.message}`);
    else if (r.data === 'placed' || r.data === 'moved' || r.data === 'already') placed++;
    else outcomes.push(`row ${pl.row + 1}: ${pl.setLabel} → ${String(r.data)}`);
  }
  // Roster-seeded patrol groups the sheet moved everyone out of are noise.
  for (const [label, setId] of setIdByLabel) {
    if (label !== 'Patrols') continue;
    const groups = must(await supabase.from('signup_groups').select('id').eq('set_id', setId), 'patrol groups') as { id: number }[];
    for (const g of groups) {
      const { count } = await supabase.from('signup_group_members').select('*', { count: 'exact', head: true }).eq('group_id', g.id);
      if ((count ?? 0) === 0) await supabase.from('signup_groups').delete().eq('id', g.id);
    }
  }
  console.log(`✓ ${placed} placements${outcomes.length ? `\n  ${outcomes.join('\n  ')}` : ''}`);

  // 6. money — the same rows the Money tab's actions write, batch-tagged.
  for (const p of plan.payments) {
    const entryId = entryIdByRow.get(p.row) as number;
    must(
      await supabase
        .from('financial_transactions')
        .insert({
          occurred_on: paidOn,
          account: 'checking',
          amount: p.amount,
          kind: 'event_fee',
          method: p.method,
          person_id: p.personId,
          signup_entry_id: entryId,
          calendar_entry_id: cal.id,
          activity_label: title,
          memo: p.memo,
          source: 'import',
          import_batch: BATCH
        })
        .select('id')
        .single(),
      `payment (${p.personId})`
    );
  }
  console.log(`✓ ${plan.payments.length} payments`);
  for (const e of plan.expenses) {
    must(
      await supabase
        .from('financial_transactions')
        .insert({
          occurred_on: e.occurredOn,
          account: 'checking',
          amount: -Math.abs(e.amount),
          kind: 'expense',
          method: 'bank',
          memo: e.memo,
          calendar_entry_id: cal.id,
          activity_label: title,
          source: 'import',
          import_batch: BATCH
        })
        .select('id')
        .single(),
      `expense (${e.memo})`
    );
  }
  console.log(`✓ ${plan.expenses.length} expenses`);
  for (const r of plan.reimbursements) {
    must(
      await supabase
        .from('reimbursement_requests')
        .insert({
          requester_person_id: r.requesterPersonId,
          amount: r.amount,
          description: `${title}: ${r.description}`,
          receipt_path: null,
          status: 'approved',
          calendar_entry_id: cal.id
        })
        .select('id')
        .single(),
      `reimbursement (${r.description})`
    );
  }
  console.log(`✓ ${plan.reimbursements.length} reimbursement requests (approved, awaiting payout)`);

  console.log(`\nDone. Roster: /admin/rosters/${sig.id}  ·  Money: /admin/rosters/${sig.id}/money  ·  Snapshot: /admin/snapshot/${sig.id}`);
  console.log(`Undo: npm run import-event-sheet -- "${xlsxPath}" "${tabName}" --rollback`);
}

// ── main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`Target: ${SUPABASE_URL}${isLocal ? ' (local)' : ' (REMOTE)'}  ·  batch ${BATCH}`);
  if (ROLLBACK) return rollback();

  const parsed = readTab();
  const { resolved, unmatched } = await resolvePeople(parsed);
  const plan = buildImportPlan(parsed, resolved, { eventDate: eventDate ?? '1970-01-01' });

  console.log(`\nTab "${tabName}" → "${titleOverride ?? parsed.title ?? tabName}"`);
  console.log(`People: ${parsed.people.length} on the sheet, ${resolved.length} matched, ${unmatched.length} unmatched${unmatched.length ? ` (${unmatched.join('; ')})` : ''}`);
  const drivers = plan.entries.filter((e) => e.drivesOut || e.drivesBack);
  console.log(`Drivers: ${drivers.map((d) => `${d.displayName} ${d.vehicleSeatsOut ?? '-'}/${d.vehicleSeatsBack ?? '-'}`).join(', ') || 'none'}`);
  console.log(`Entries: ${plan.entries.length} (${plan.entries.filter((e) => e.personKind === 'scout').length} scouts, ${plan.entries.filter((e) => e.personKind === 'adult').length} adults, ${plan.entries.filter((e) => e.participantClass === 'junior_leader').length} JL)`);
  console.log(`Sets: ${parsed.groupSets.map((g) => g.label).join(', ') || 'none'} + Cars there / Cars back + presets`);
  console.log(`Placements: ${plan.placements.filter((p) => p.driverRow != null).length} car, ${plan.placements.filter((p) => p.groupName).length} named`);
  console.log(`Price: ${plan.price == null ? 'none' : `$${plan.price}`}  ·  payments: ${plan.payments.length} ($${plan.payments.reduce((n, p) => n + p.amount, 0)})`);
  console.log(`Expenses: ${plan.expenses.length} ($${plan.expenses.reduce((n, e) => n + e.amount, 0).toFixed(2)})  ·  reimbursements: ${plan.reimbursements.length} ($${plan.reimbursements.reduce((n, r) => n + r.amount, 0)})`);
  if (plan.warnings.length) console.log(`\nWarnings:\n  ${plan.warnings.join('\n  ')}`);

  if (!APPLY) {
    console.log('\nDry run — nothing written. Add --apply to import.');
    return;
  }
  await apply(parsed, resolved, plan);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
