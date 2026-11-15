import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestScout, deleteTestScout, type TestScout } from './helpers/signup-fixtures';

/**
 * Family links built everywhere (Plans/Person-Record-One-Save.md, step 2): the rule lives in
 * the database (household_link_gaps / link_household_relationships + two AFTER INSERT
 * triggers), so every writer gets the same links. Real local DB, test-owned rows only.
 */
const admin = adminClient();

interface Fixture {
  householdId: number;
  scouts: TestScout[];
  adults: number[];
}

let fx: Fixture | null = null;

async function household(label: string): Promise<number> {
  const { data, error } = await admin.from('households').insert({ label: `ZZVITEST Cascade ${label}` }).select('id').single();
  if (error) throw new Error(error.message);
  return data!.id as number;
}

async function adult(name: string): Promise<number> {
  const { data, error } = await admin
    .from('people')
    .insert({ first_name: 'ZZVITEST', last_name: name, display_name: `ZZVITEST Cascade ${name}`, active: true })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  fx!.adults.push(data!.id as number);
  return data!.id as number;
}

async function join(householdId: number, personId: number) {
  const { error } = await admin.from('household_members').insert({ household_id: householdId, person_id: personId });
  if (error) throw new Error(error.message);
}

async function relate(a: number, b: number, type: string) {
  const { error } = await admin.from('relationships').insert({ person_id: a, related_person_id: b, type, is_guardian: false });
  if (error) throw new Error(error.message);
}

async function linksOf(ids: number[]): Promise<string[]> {
  const { data } = await admin
    .from('relationships')
    .select('person_id, related_person_id, type')
    .in('person_id', ids)
    .in('related_person_id', ids);
  return ((data ?? []) as { person_id: number; related_person_id: number; type: string }[])
    .map((r) => `${r.person_id} ${r.type} ${r.related_person_id}`)
    .sort();
}

async function setup(label: string, scoutCount: number): Promise<Fixture> {
  fx = { householdId: 0, scouts: [], adults: [] };
  fx.householdId = await household(label);
  for (let i = 0; i < scoutCount; i++) fx.scouts.push(await createTestScout(admin, `Cascade${label}${i}`));
  return fx;
}

afterEach(async () => {
  if (!fx) return;
  const ids = [...fx.adults, ...fx.scouts.map((s) => s.personId)];
  await admin.from('relationships').delete().in('person_id', ids);
  await admin.from('relationships').delete().in('related_person_id', ids);
  await admin.from('household_members').delete().eq('household_id', fx.householdId);
  await admin.from('households').delete().eq('id', fx.householdId);
  await admin.from('audit_log').delete().in('entity_id', ids.map(String)).like('summary', 'Linked automatically%');
  for (const s of fx.scouts) await deleteTestScout(admin, s);
  if (fx.adults.length) await admin.from('people').delete().in('id', fx.adults);
  fx = null;
});

describe('household link cascade', () => {
  it('Leader_LinksParentToAllScouts_WhenAddingParentToHousehold', async () => {
    const f = await setup('ParentAll', 2);
    const [a, b] = f.scouts.map((s) => s.personId);
    await join(f.householdId, a);
    await join(f.householdId, b);
    const mom = await adult('Mom');
    await join(f.householdId, mom);
    await relate(mom, a, 'parent_of');
    const links = await linksOf([mom, a, b]);
    expect(links.filter((l) => l.startsWith(`${mom} `))).toEqual([`${mom} parent_of ${a}`, `${mom} parent_of ${b}`].sort());
  });

  it('Leader_LinksScoutToAllParents_WhenAddingScoutToHousehold', async () => {
    const f = await setup('ScoutAll', 2);
    const [a, b] = f.scouts.map((s) => s.personId);
    const mom = await adult('Mom2');
    const dad = await adult('Dad2');
    for (const p of [a, mom, dad]) await join(f.householdId, p);
    await relate(mom, a, 'parent_of');
    await relate(dad, a, 'guardian_of');
    await join(f.householdId, b);
    const links = await linksOf([mom, dad, b]);
    expect(links).toEqual([`${dad} guardian_of ${b}`, `${mom} parent_of ${b}`].sort());
  });

  it('Leader_LinksNothing_WhenAddingAdultWithNoRelationship', async () => {
    const f = await setup('NoRel', 1);
    const [a] = f.scouts.map((s) => s.personId);
    await join(f.householdId, a);
    const grandma = await adult('Grandma');
    await join(f.householdId, grandma);
    expect(await linksOf([grandma, a])).toEqual([]);
  });

  it('Leader_LinksSiblings_WhenAddingScoutToHouseholdWithScouts', async () => {
    const f = await setup('Sibs', 3);
    const [a, b, c] = f.scouts.map((s) => s.personId);
    for (const p of [a, b, c]) await join(f.householdId, p);
    const links = await linksOf([a, b, c]);
    expect(links).toHaveLength(6);
  });

  it('Gaps_ListWhatALinkWouldAdd_WithoutWriting', async () => {
    const f = await setup('Gaps', 2);
    const [a, b] = f.scouts.map((s) => s.personId);
    await join(f.householdId, a);
    await join(f.householdId, b);
    await admin.from('relationships').delete().eq('person_id', b).eq('related_person_id', a);
    const { data } = await admin.rpc('household_link_gaps', { p_household_id: f.householdId });
    expect(data).toEqual([{ person_id: b, related_person_id: a, type: 'sibling_of' }]);
  });

  it('Trigger_WritesHistoryForEachAutomaticLink', async () => {
    const f = await setup('Audit', 2);
    const [a, b] = f.scouts.map((s) => s.personId);
    await join(f.householdId, a);
    await join(f.householdId, b);
    const { count } = await admin
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .in('entity_id', [String(a), String(b)])
      .like('summary', 'Linked automatically%');
    expect(count).toBe(2);
  });
});
