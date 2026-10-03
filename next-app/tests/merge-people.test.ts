import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, deleteTestEvent, TEST_PREFIX, type TestEvent } from './helpers/signup-fixtures';

/**
 * Regression coverage for the qa-lead finding (2026-07-20): merge_people
 * reassigned person_id everywhere EXCEPT signup_entries, which didn't exist
 * as a person_id-bearing table when merge_people was first written. Left
 * alone, a merge silently reopens D-042 — a signup submitted before the
 * merge keeps pointing at the loser's now-superseded person_id forever.
 */
describe('merge_people — signup_entries reassignment', () => {
  let event: TestEvent | null = null;
  let personIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    // Event first — deleting it cascades away any signup_entries rows that
    // hold an FK on these people; deleting people first would leave that FK
    // dangling and fail silently.
    if (event) await deleteTestEvent(admin, event);
    if (personIds.length > 0) {
      const { error } = await admin.from('people').delete().in('id', personIds);
      if (error) throw new Error(`fixture cleanup: people delete failed: ${error.message}`);
    }
    event = null;
    personIds = [];
  });

  async function makePerson(admin: ReturnType<typeof adminClient>, label: string) {
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: `${TEST_PREFIX} Merge ${label}` })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
    personIds.push(data.id);
    return data.id as number;
  }

  it('Merge_ReassignsSignupEntries_WhenLoserHadPriorSignup', async () => {
    const admin = adminClient();
    event = await createTestEvent(admin);
    const survivor = await makePerson(admin, 'Survivor1');
    const loser = await makePerson(admin, 'Loser1');

    const { error: insertErr } = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId,
      person_kind: 'adult',
      person_id: loser,
      status: 'yes'
    });
    expect(insertErr).toBeNull();

    const { error: mergeErr } = await admin.rpc('merge_people', {
      p_survivor: survivor,
      p_loser: loser,
      p_decided_by: 'test:merge'
    });
    expect(mergeErr).toBeNull();

    const { data: entry } = await admin
      .from('signup_entries')
      .select('person_id')
      .eq('event_signup_id', event.eventSignupId)
      .single();
    expect(entry?.person_id).toBe(survivor);
  });

  it('Merge_DeactivatesTheLoser_SoItLeavesEveryActiveList', async () => {
    // People-model audit 2026-08-26: all 13 merged-away rows were still
    // active. A retired identity must not show up in active-filtered lists.
    const admin = adminClient();
    const survivor = await makePerson(admin, 'Survivor3');
    const loser = await makePerson(admin, 'Loser3');
    const { error: mergeErr } = await admin.rpc('merge_people', {
      p_survivor: survivor,
      p_loser: loser,
      p_decided_by: 'test:merge'
    });
    expect(mergeErr).toBeNull();
    const { data } = await admin.from('people').select('active, merged_into_person_id').eq('id', loser).single();
    expect(data).toMatchObject({ active: false, merged_into_person_id: survivor });
  });

  it('Merge_Blocks_WhenBothSidesHaveLiveSignupForSameEvent', async () => {
    const admin = adminClient();
    event = await createTestEvent(admin);
    const survivor = await makePerson(admin, 'Survivor2');
    const loser = await makePerson(admin, 'Loser2');

    const { error: e1 } = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId,
      person_kind: 'adult',
      person_id: survivor,
      status: 'yes'
    });
    const { error: e2 } = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId,
      person_kind: 'adult',
      person_id: loser,
      status: 'yes'
    });
    expect(e1).toBeNull();
    expect(e2).toBeNull();

    const { error: mergeErr } = await admin.rpc('merge_people', {
      p_survivor: survivor,
      p_loser: loser,
      p_decided_by: 'test:merge'
    });
    expect(mergeErr).not.toBeNull();
    expect(mergeErr?.message).toContain('MERGE_BLOCKED_DUPLICATE_SIGNUP');

    // Blocked means blocked — nothing committed, not even the earlier steps.
    const { data: loserPerson } = await admin
      .from('people')
      .select('merged_into_person_id')
      .eq('id', loser)
      .single();
    expect(loserPerson?.merged_into_person_id).toBeNull();
  });
});

/**
 * Menu Monster workspace (Plans/Menu-Monster-Scout-Workspace.md, Phase 2): every
 * person FK on mm_* is RESTRICT, so merge_people must re-point them to the survivor.
 */
describe('merge_people — Menu Monster references', () => {
  const MM_PKG = 'vitest-merge-package';
  const MM_RECIPE = 'S-0000ab01';
  const MM_TYPED = 'x-0000ab01';
  let people: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    await admin.from('mm_price_history').delete().eq('package_id', MM_PKG);
    await admin.from('mm_packages').delete().eq('id', MM_PKG);
    await admin.from('mm_recipes').delete().eq('id', MM_RECIPE);
    await admin.from('mm_ingredients').delete().eq('id', MM_TYPED);
    if (people.length > 0) {
      await admin.from('mm_menus').delete().in('owner_person_id', people);
      const { error } = await admin.from('people').delete().in('id', people);
      if (error) throw new Error(`fixture cleanup: people delete failed: ${error.message}`);
    }
    people = [];
  });

  async function makePerson(label: string) {
    const { data, error } = await adminClient()
      .from('people')
      .insert({ display_name: `${TEST_PREFIX} MergeMM ${label}` })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
    people.push(data.id);
    return data.id as number;
  }

  async function merge(survivor: number, loser: number) {
    const { error } = await adminClient().rpc('merge_people', {
      p_survivor: survivor,
      p_loser: loser,
      p_decided_by: 'test:merge'
    });
    expect(error).toBeNull();
  }

  it('Merge_MovesMenusToSurvivor_WhenLoserOwnsAMenu', async () => {
    const admin = adminClient();
    const survivor = await makePerson('Survivor2');
    const loser = await makePerson('Loser2');
    const { data: menu, error } = await admin
      .from('mm_menus')
      .insert({ owner_person_id: loser, name: 'vitest-merge-menu', headcount: 8 })
      .select('id')
      .single();
    expect(error).toBeNull();

    await merge(survivor, loser);

    const { data } = await admin.from('mm_menus').select('owner_person_id').eq('id', menu!.id).single();
    expect(data?.owner_person_id).toBe(survivor);
  });

  it('Merge_MovesPriceHistoryAndPackageAuthorship_WhenLoserReportedPrices', async () => {
    const admin = adminClient();
    const survivor = await makePerson('Survivor3');
    const loser = await makePerson('Loser3');
    const { data: ing } = await admin.from('mm_ingredients').select('id').is('retired_at', null).limit(1).single();
    const { error: pkgErr } = await admin
      .from('mm_packages')
      .insert({ id: MM_PKG, ingredient_id: ing!.id, name: 'vitest', price: 2, added_by_person_id: loser });
    expect(pkgErr).toBeNull();
    const { error: histErr } = await admin.from('mm_price_history').insert({
      package_id: MM_PKG,
      old_price: 2,
      new_price: 3,
      reported_by_person_id: loser,
      decided_by_person_id: loser,
      decided_at: new Date().toISOString(),
      status: 'reverted'
    });
    expect(histErr).toBeNull();

    await merge(survivor, loser);

    const { data: pkg } = await admin.from('mm_packages').select('added_by_person_id').eq('id', MM_PKG).single();
    const { data: hist } = await admin
      .from('mm_price_history')
      .select('reported_by_person_id, decided_by_person_id')
      .eq('package_id', MM_PKG)
      .single();
    expect({ pkg, hist }).toEqual({
      pkg: { added_by_person_id: survivor },
      hist: { reported_by_person_id: survivor, decided_by_person_id: survivor }
    });
  });
  it('Merge_MovesRecipeAuthorship_AndKeepsTheFrozenCredit', async () => {
    const admin = adminClient();
    const survivor = await makePerson('Survivor4');
    const loser = await makePerson('Loser4');
    const { error } = await admin.from('mm_recipes').insert({
      id: MM_RECIPE,
      name: 'vitest merge recipe',
      status: 'published',
      author_person_id: loser,
      shared_at: new Date().toISOString(),
      attribution_label: 'Old N.'
    });
    expect(error).toBeNull();

    await merge(survivor, loser);

    const { data } = await admin.from('mm_recipes').select('author_person_id, attribution_label').eq('id', MM_RECIPE).single();
    expect(data).toEqual({ author_person_id: survivor, attribution_label: 'Old N.' });
  });
  it('Merge_MovesTypedInIngredientAuthorship', async () => {
    const admin = adminClient();
    const survivor = await makePerson('Survivor5');
    const loser = await makePerson('Loser5');
    const { error } = await admin.from('mm_ingredients').insert({
      id: MM_TYPED, name: 'vitest merge typed', unit_kind: 'weight', unit_key: 'ozw', unit_one: 'oz', unit_many: 'oz', section: 'dry',
      added_by_person_id: loser, needs_match_at: new Date().toISOString()
    });
    expect(error).toBeNull();

    await merge(survivor, loser);

    const { data } = await admin.from('mm_ingredients').select('added_by_person_id').eq('id', MM_TYPED).single();
    expect(data?.added_by_person_id).toBe(survivor);
  });
});
