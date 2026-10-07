import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { CATALOG } from './helpers/menu-monster-fixture';
import { loadMenuWith, saveMenuWith, deleteMenuWith, createMenuWith } from '../src/lib/menu-monster/menus-store';
import { loadActiveScoutOptionsWith } from '../src/lib/menu-monster/menu-planners';

/**
 * Planned by (Plans/Menu-Monster-Planned-By.md): mm_menu_planners, the scouts who planned a menu. Informational;
 * the table is the truth, saveMenuWith replaces the set, merge_people repoints it, a menu delete drops it.
 * Fixtures: Charlie Walters (person 39, Patrick's TEST scout) owns the menu; Jack Porter (25) and Charlie plan it.
 * Throwaway people for the merge test are created here and removed by id.
 */

const OWNER = 39;
const JACK = 25;
const MARKER = 'Vitest planners menu';
const admin = adminClient();
const actor = { personId: OWNER, label: 'Vitest scout' };
const menuIds: string[] = [];
const peopleIds: number[] = [];

async function seedMenu(): Promise<string> {
  const { data, error } = await admin.from('mm_menus').insert({ owner_person_id: OWNER, name: MARKER, context: 'camp', headcount: 8 }).select('id').single();
  if (error) throw new Error(error.message);
  menuIds.push(data.id as string);
  return data.id as string;
}
const plannerIds = async (menuId: string) => ((await admin.from('mm_menu_planners').select('person_id').eq('menu_id', menuId)).data ?? []).map((r) => r.person_id as number).sort((a, b) => a - b);
async function seedPerson(name: string): Promise<number> {
  const { data, error } = await admin.from('people').insert({ first_name: 'Vitest', last_name: name, display_name: `Vitest ${name}` }).select('id').single();
  if (error) throw new Error(error.message);
  peopleIds.push(data.id as number);
  return data.id as number;
}
async function saveWith(menuId: string, plannedBy: number[] | undefined) {
  const stored = await loadMenuWith(admin, menuId);
  if (!stored) throw new Error('menu missing');
  return saveMenuWith(admin, actor, menuId, { ...stored.menu, plannedBy }, stored.updatedAt, CATALOG);
}

afterEach(async () => {
  for (const id of menuIds.splice(0)) await admin.from('mm_menus').delete().eq('id', id);
  for (const id of peopleIds.splice(0)) {
    await admin.from('mm_menu_planners').delete().eq('person_id', id);
    await admin.from('people').delete().eq('id', id);
  }
  await admin.from('audit_log').delete().eq('entity_type', 'menu').like('summary', `%${MARKER}%`);
});

describe('mm_menu_planners', () => {
  it('SaveMenu_ReplacesThePlannerSet', async () => {
    const id = await seedMenu();
    expect((await saveWith(id, [OWNER, JACK])).status).toBe('saved');
    const first = await plannerIds(id);
    expect((await saveWith(id, [JACK])).status).toBe('saved');
    const second = await plannerIds(id);
    // A save that carries no set leaves it alone.
    expect((await saveWith(id, undefined)).status).toBe('saved');
    const loaded = await loadMenuWith(admin, id);
    expect([first, second, await plannerIds(id), loaded?.menu.plannedBy, loaded?.planners.length]).toEqual([[JACK, OWNER].sort((a, b) => a - b), [JACK], [JACK], [JACK], 1]);
  });

  it('SaveMenu_DropsAnIdThatIsNotAScout', async () => {
    const id = await seedMenu();
    const stranger = await seedPerson('Stranger');
    await saveWith(id, [stranger, JACK]);
    expect(await plannerIds(id)).toEqual([JACK]);
  });

  it('LoadMenu_NamesThePlanners_ByDisplayName_AToZ', async () => {
    const id = await seedMenu();
    await saveWith(id, [OWNER, JACK]);
    const names = (await loadMenuWith(admin, id))?.planners.map((p) => p.name) ?? [];
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names.length).toBe(2);
  });

  it('CreateMenu_KeepsThePlannersItWasBornWith', async () => {
    const stub = { name: MARKER, context: 'camp' as const, calendarEntryId: null, startDate: null, headcount: 8, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, budgetPerPersonMeal: 4, dayCount: 1, shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} }, actuals: {}, meals: [], plannedBy: [JACK] };
    const id = await createMenuWith(admin, actor, stub, CATALOG);
    menuIds.push(id);
    expect(await plannerIds(id)).toEqual([JACK]);
  });

  it('MergePeople_RepointsPlanners', async () => {
    const id = await seedMenu();
    const other = await seedMenu();
    const survivor = await seedPerson('Survivor');
    const loser = await seedPerson('Loser');
    // The loser planned both menus; the survivor already planned the first: one row each, no duplicate.
    await admin.from('mm_menu_planners').insert([
      { menu_id: id, person_id: survivor },
      { menu_id: id, person_id: loser },
      { menu_id: other, person_id: loser }
    ]);
    const { error } = await admin.rpc('merge_people', { p_survivor: survivor, p_loser: loser, p_decided_by: 'vitest' });
    expect(error).toBeNull();
    expect([await plannerIds(id), await plannerIds(other)]).toEqual([[survivor], [survivor]]);
  });

  it('DeleteMenu_DropsPlanners', async () => {
    const id = await seedMenu();
    await saveWith(id, [JACK]);
    expect(await deleteMenuWith(admin, actor, id)).toBe(true);
    expect(await plannerIds(id)).toEqual([]);
  });

  it('DeletePerson_DropsTheirPlannerRows', async () => {
    const id = await seedMenu();
    const p = await seedPerson('Gone');
    await admin.from('mm_menu_planners').insert({ menu_id: id, person_id: p });
    await admin.from('people').delete().eq('id', p);
    peopleIds.pop();
    expect(await plannerIds(id)).toEqual([]);
  });

  it('ActiveScoutOptions_AreScoutsNamedFromPeople', async () => {
    const options = await loadActiveScoutOptionsWith(admin);
    const { data } = await admin.from('people').select('display_name').eq('id', JACK).single();
    expect(options.find((o) => o.personId === JACK)?.name).toBe(data?.display_name);
  });
});
