import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  loadMbPageResources,
  loadMbRequirementNotes,
  loadMbRequirementOptions,
  requirementTargetLabel,
  resolveRequirementLabel
} from '../src/lib/library-data';

/**
 * Library MB consolidation, Phase 3 (Plans/Library-MB-Consolidation.md) —
 * the admin picker gains a badge → requirement two-step so the webmaster can
 * place a resource, re-target one, or write a narrative for ONE merit badge
 * requirement. No write path changes: these tests drive the SAME upserts
 * addPlacementAction / saveNarrativeAction perform (they can't be called
 * from Vitest — requireCapability needs a request) with the exact value the
 * picker emits (`mb_req:{mbId}-{code}`), then read back through the public
 * loaders Phase 1 shipped.
 *
 * Real local Postgres, no mocks (D-049). The badge is a real catalog row
 * here — unlike library-mb-page-data.test.ts — because the requirement
 * option loader and the queue label both read merit_badge_requirements.
 * Every fixture id carries the `zz-lib-mbreq` prefix and is deleted in afterAll.
 */

const MB = 'zz-lib-mbreq';
const MB_NAME = 'ZZVitest Chemistry';
const REVIEWER = 'VITEST';

type Admin = ReturnType<typeof adminClient>;

let admin: Admin;
const resourceIds: number[] = [];

async function purgeStale(a: Admin) {
  await a.from('requirement_notes').delete().like('target_key', `${MB}%`);
  await a.from('library_resources').delete().like('title', `[TEST] ${MB} %`);
  await a.from('merit_badges').delete().eq('id', MB); // requirements cascade
}

async function makeResource(a: Admin, name: string): Promise<number> {
  const { data, error } = await a
    .from('library_resources')
    .insert({
      title: `[TEST] ${MB} ${name}`,
      kind: 'link',
      url: `https://example.com/${MB}/${name}`,
      status: 'published',
      visibility: 'public',
      reviewed_by: REVIEWER
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`fixture: resource insert failed: ${error?.message}`);
  resourceIds.push(data.id as number);
  return data.id as number;
}

/** Exactly addPlacementAction's write, fed the value the picker emits. */
async function placeFromPicker(a: Admin, resourceId: number, pickerValue: string) {
  const sep = pickerValue.indexOf(':');
  const kind = pickerValue.slice(0, sep);
  const key = pickerValue.slice(sep + 1);
  const { error } = await a
    .from('library_placements')
    .upsert(
      { resource_id: resourceId, target_kind: kind, target_key: key },
      { onConflict: 'resource_id,target_kind,target_key', ignoreDuplicates: true }
    );
  if (error) throw new Error(`placement upsert failed: ${error.message}`);
}

beforeAll(async () => {
  admin = adminClient();
  await purgeStale(admin);
  const { error: mbErr } = await admin.from('merit_badges').insert({ id: MB, name: MB_NAME, eagle: false });
  if (mbErr) throw new Error(`fixture: badge insert failed: ${mbErr.message}`);

  // Inserted deliberately OUT of display order so the loader has to sort:
  // top-level 6, then 4, then 1; children of 4 as 4b then 4a.
  const { data: tops, error: topErr } = await admin
    .from('merit_badge_requirements')
    .insert([
      // Every row names complete_rule: a mixed-key batch makes PostgREST
      // send null for the absent key, not the column default.
      { mb_id: MB, code: '6', label: 'Identify five fields of chemistry', sort_order: 3, complete_rule: 'all' },
      { mb_id: MB, code: '4', label: 'Safety', sort_order: 2, complete_rule: 'any' },
      { mb_id: MB, code: '1', label: 'Chemical safety rules', sort_order: 1, complete_rule: 'all' }
    ])
    .select('id, code');
  if (topErr || !tops) throw new Error(`fixture: requirement insert failed: ${topErr?.message}`);
  const four = (tops as { id: number; code: string }[]).find((r) => r.code === '4')!;
  const { error: leafErr } = await admin.from('merit_badge_requirements').insert([
    { mb_id: MB, parent_id: four.id, code: '4b', label: 'Describe the four classes of fires', sort_order: 2 },
    { mb_id: MB, parent_id: four.id, code: '4a', label: 'Compare two waterproofing methods', sort_order: 1 }
  ]);
  if (leafErr) throw new Error(`fixture: leaf insert failed: ${leafErr.message}`);
});

afterAll(async () => {
  await admin.from('requirement_notes').delete().like('target_key', `${MB}%`);
  if (resourceIds.length) await admin.from('library_resources').delete().in('id', resourceIds);
  await admin.from('merit_badges').delete().eq('id', MB);
});

const ids = (list: { id: number }[] | undefined) => (list ?? []).map((r) => r.id);

describe('Library admin picker — individual merit badge requirement (Phase 3)', () => {
  it('LoadMbRequirementOptions_ReturnsOneBadgesTree_InOrder', async () => {
    const options = await loadMbRequirementOptions(admin, MB);
    expect(options.map((o) => `${o.depth}:${o.code}`)).toEqual(['0:1', '0:4', '1:4a', '1:4b', '0:6']);
    expect(options.find((o) => o.code === '4a')).toMatchObject({
      value: `mb_req:${MB}-4a`,
      label: 'Compare two waterproofing methods'
    });
  });

  it('LoadMbRequirementOptions_ReturnsNothing_ForAnUnknownBadge', async () => {
    expect(await loadMbRequirementOptions(admin, 'zz-lib-mbreq-does-not-exist')).toEqual([]);
  });

  it('Webmaster_PlacesResourceOnIndividualMbRequirement_ViaAdminPicker', async () => {
    const id = await makeResource(admin, 'placed on 4a');
    await placeFromPicker(admin, id, `mb_req:${MB}-4a`);

    const { wholeBadge, byLeafCode } = await loadMbPageResources(admin, MB, false);
    expect({
      under4a: ids(byLeafCode.get('4a')),
      leakedToWholeBadge: ids(wholeBadge).includes(id)
    }).toEqual({ under4a: [id], leakedToWholeBadge: false });
  });

  it('Webmaster_RetargetsResourceFromWholeBadgeToSpecificRequirement', async () => {
    const id = await makeResource(admin, 'retargeted');
    await placeFromPicker(admin, id, `mb:${MB}`);
    const before = await loadMbPageResources(admin, MB, false);
    expect(ids(before.wholeBadge)).toContain(id);

    // Re-target = add the mb_req chip, then remove the mb chip — the two
    // existing placement actions, nothing new.
    await placeFromPicker(admin, id, `mb_req:${MB}-4b`);
    const { data: mbPlacement } = await admin
      .from('library_placements')
      .select('id')
      .eq('resource_id', id)
      .eq('target_kind', 'mb')
      .eq('target_key', MB)
      .single();
    await admin.from('library_placements').delete().eq('id', mbPlacement!.id);

    const after = await loadMbPageResources(admin, MB, false);
    expect({
      stillOnWholeBadge: ids(after.wholeBadge).includes(id),
      under4b: ids(after.byLeafCode.get('4b'))
    }).toEqual({ stillOnWholeBadge: false, under4b: [id] });
  });

  it('Webmaster_WritesNarrativeForIndividualMbRequirement_ViaAdminPicker', async () => {
    // saveNarrativeAction's upsert, fed the picker's value.
    const target = `mb_req:${MB}-4a`;
    const sep = target.indexOf(':');
    const { error } = await admin.from('requirement_notes').upsert(
      {
        target_kind: target.slice(0, sep),
        target_key: target.slice(sep + 1),
        narrative_md: 'Waterproofing: try wax vs. spray on two scraps of canvas.',
        updated_by: REVIEWER,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'target_kind,target_key' }
    );
    expect(error).toBeNull();

    const notes = await loadMbRequirementNotes(admin, MB);
    expect({
      leaf4a: notes.byLeafCode.get('4a')?.narrative_md,
      wholeBadge: notes.wholeBadge
    }).toEqual({ leaf4a: 'Waterproofing: try wax vs. spray on two scraps of canvas.', wholeBadge: null });
  });

  it('ModerationQueue_ShowsRequirementLabel_ForMbReqTarget', async () => {
    const resolved = await resolveRequirementLabel(admin, 'mb_req', `${MB}-4a`);
    expect(resolved).toMatchObject({ parentId: MB, parentName: MB_NAME, code: '4a' });
    expect(requirementTargetLabel(resolved!)).toBe(
      `${MB_NAME} — Requirement 4a: Compare two waterproofing methods`
    );
  });

  it('ModerationQueue_FallsBackToCode_WhenRequirementLabelUnknown', async () => {
    const resolved = await resolveRequirementLabel(admin, 'mb_req', `${MB}-99z`);
    expect(resolved).toMatchObject({ parentId: MB, parentName: MB_NAME, code: '99z', label: null });
    expect(requirementTargetLabel(resolved!)).toBe(`${MB_NAME} — Requirement 99z`);
  });
});
