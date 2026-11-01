/**
 * Split groups (Plans/Meeting-Planner-III-Split-Groups.md, S2): read a meeting's splits for placement, and the three
 * writes (split, merge, unmerge). Server-only, service role; the actions gate (seed). Each write runs under the
 * meeting's seed lock in its RPC (migration 20261231900000).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface GroupSplits {
  /** Base group key → each section's listed requirement keys, Group 1 first. Merged ones included: the engine reads
   *  `mergedBases` and ignores their sections. */
  splits: Map<string, string[][]>;
  /** Each section's level (requirements done to start there), by base key. */
  splitLevels: Map<string, number[]>;
  /** Base keys whose split is merged (soft): their '~2'/'~3' keys read as the base. */
  mergedBases: Set<string>;
}

type SplitRow = { group_key: string; section: number; item_keys: string[] | null; from_done: number | null; merged_at: string | null };

export async function loadGroupSplits(sb: SupabaseClient, entryId: number): Promise<GroupSplits> {
  const { data, error } = await sb
    .from('meeting_group_splits')
    .select('group_key, section, item_keys, from_done, merged_at')
    .eq('calendar_entry_id', entryId)
    .order('group_key')
    .order('section');
  if (error) throw new Error(error.message);
  const splits = new Map<string, string[][]>();
  const splitLevels = new Map<string, number[]>();
  const mergedBases = new Set<string>();
  for (const r of (data ?? []) as SplitRow[]) {
    const list = splits.get(r.group_key) ?? [];
    list[r.section - 1] = r.item_keys ?? [];
    splits.set(r.group_key, list);
    const levels = splitLevels.get(r.group_key) ?? [];
    levels[r.section - 1] = r.from_done ?? 0;
    splitLevels.set(r.group_key, levels);
    if (r.merged_at) mergedBases.add(r.group_key);
  }
  // A gap (a section row missing) is an empty section, never a hole the engine trips on.
  for (const [k, list] of splits) splits.set(k, Array.from(list, (x) => x ?? []));
  for (const [k, list] of splitLevels) splitLevels.set(k, Array.from(list, (x) => x ?? 0));
  return { splits, splitLevels, mergedBases };
}

/** How many groups each split base key on the meeting has right now (merged ones left out): topicWords' `groups`. */
export async function loadGroupSections(sb: SupabaseClient, entryId: number): Promise<Map<string, number>> {
  const { data, error } = await sb.from('meeting_group_splits').select('group_key').eq('calendar_entry_id', entryId).is('merged_at', null);
  if (error) throw new Error(error.message);
  const out = new Map<string, number>();
  for (const r of (data ?? []) as { group_key: string }[]) out.set(r.group_key, (out.get(r.group_key) ?? 0) + 1);
  return out;
}

export type SplitWrite = { ok: true } | { ok: false; error: string };

/** The RPCs' own messages are written for people; anything else is not shown raw. */
const KNOWN = /^(That group|A group splits|Too many requirements|Not a requirement of this group|That meeting)/;
const said = (message: string) => (KNOWN.test(message) ? message : 'Couldn’t save that. Try again.');
const result = ({ error }: { error: { message: string } | null }): SplitWrite => (error ? { ok: false, error: said(error.message) } : { ok: true });

/** Set a group's 2-3 sections (Group 1 first) and their levels (null = all 0, by fit), replacing its split and
 *  un-merging it. */
export async function splitGroup(
  sb: SupabaseClient,
  entryId: number,
  group: string,
  sections: readonly (readonly string[])[],
  levels: readonly number[] | null,
  actorPersonId: number
): Promise<SplitWrite> {
  return result(await sb.rpc('meeting_split_group', { p_entry: entryId, p_group: group, p_sections: sections, p_levels: levels, p_actor: actorPersonId }));
}

/** Merge a split group back into one; its sections are kept for Split again. */
export async function mergeGroup(sb: SupabaseClient, entryId: number, group: string, actorPersonId: number): Promise<SplitWrite> {
  return result(await sb.rpc('meeting_merge_group', { p_entry: entryId, p_group: group, p_actor: actorPersonId }));
}

/** Bring a merged split back as it was. */
export async function unmergeGroup(sb: SupabaseClient, entryId: number, group: string, actorPersonId: number): Promise<SplitWrite> {
  return result(await sb.rpc('meeting_unmerge_group', { p_entry: entryId, p_group: group, p_actor: actorPersonId }));
}
