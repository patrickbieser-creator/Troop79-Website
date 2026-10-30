/**
 * Meeting invite helpers (Plans/Matcher-Tune-Up.md T-5; Plans/Meeting-Planner-II.md P2b): an invite's words, the
 * scout candidates for a topic, and the timed send the teacher digest uses. Server-only. The old one-off senders
 * (teach and pick invites, reminders) retired with Emails E5: every meeting email goes out from the Emails screen.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBoardScouts, loadEffectivePicks, loadIntents, loadMeetingById, loadScoutProgress } from '@/lib/meeting-board';
import { boardName, INTENT_LABEL, type Intent } from '@/lib/meeting-board-shared';
import { loadAdvancementCatalog, type AdvancementCatalog } from '@/lib/advancement-catalog';
import { sendEmail } from '@/lib/email';
import { buildPickList, pickableKeys, rankOfKey, rankTrees, topicWords } from '@/lib/meeting-board-picklist';
import { badgeName, likelyFit, unfinishedMembers } from '@/lib/build-plan';
import { focusPicks, loadFocusTopics, loadTopicWordsFor } from '@/lib/meeting-focus-db';

/** An invite's words: catalog keys from the catalog, a focus group or freeform topic from its row on this meeting. */
export async function inviteWords(sb: SupabaseClient, entryId: number, key: string) {
  const [catalog, own] = await Promise.all([loadAdvancementCatalog(), loadTopicWordsFor(sb, entryId, key)]);
  return topicWords(key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, own.titles, { mbReqs: catalog.meritBadgeRequirements, members: own.members });
}

export interface ScoutCandidate {
  personId: number;
  name: string;
  /** 'coming', 'not sure yet', 'no answer'; '· picked it' when it's already on their list. */
  note: string;
  /** Proposed: hasn't picked it yet. The leader decides. */
  ticked: boolean;
  /** Their current rank ('scout'), for "Working on Tenderfoot" (Build a Plan B3's sheet). */
  currentRank?: string | null;
  /** B6: the likely rule (lib/build-plan likelyFit), decided here where the scout's progress is at hand. */
  likely?: boolean;
  /** B6: a mix's parts that make it likely ('4a', '5c'), for the reason line. */
  covers?: string[];
  /** B6: an MB requirement's badge, when it is in progress ('First Aid'), for the reason line. */
  badge?: string | null;
  /** B10a: their answer to "Coming Sunday?" (null: no answer); scoutsHelped reads it. */
  intent?: Intent | null;
  /** people.is_test: offered like anyone, never named or counted in a teach line (qa-lead B10a #1). */
  isTest?: boolean;
}

export type ScoutCandidatesResult = { ok: true; scouts: ScoutCandidate[] } | { ok: false; error: string };

/**
 * Meeting invites, P2: who a requirement could be offered to. Every active scout who can pick it for this meeting
 * (not done, in reach) and hasn't said they can't make it; ticked when it isn't on their list yet. A proposal only.
 * One key: scoutCandidatesMany with one key.
 */
export async function scoutCandidates(
  sb: SupabaseClient,
  input: { entryId: number; topicKey: string },
  deps: { loadCatalog?: () => Promise<AdvancementCatalog> } = {}
): Promise<ScoutCandidatesResult> {
  if (!input || typeof input.topicKey !== 'string') return { ok: false, error: 'Malformed request' };
  const res = await scoutCandidatesMany(sb, { entryId: input.entryId, keys: [input.topicKey] }, deps);
  return res.ok ? { ok: true, scouts: res.byKey.get(input.topicKey) ?? [] } : res;
}

/** B9: an active scout who hasn't said they can't make it, with what they picked (the orphan count's population). */
export interface EligibleScout {
  personId: number;
  scoutId: string;
  name: string;
  currentRank: string | null;
  /** Their effective picks for this meeting, by key. */
  picked: string[];
}

export type ScoutCandidatesManyResult =
  | {
      ok: true;
      byKey: Map<string, ScoutCandidate[]>;
      eligible: EligibleScout[];
      /** The meeting's mixes and freeform classes, as topicWords reads them (qa-lead B10a #2: the Preview's minutes). */
      words?: { titles: Map<string, string>; members: Map<string, string[]> };
    }
  | { ok: false; error: string };

/**
 * Build a Plan B0 (Plans/Build-A-Plan.md): scoutCandidates for many keys over ONE board load. The board is read once
 * for every active scout (progress, seeded focus, effective picks, answers), each scout's pick list is built once,
 * and every key is answered from those lists, so the round trips don't grow with scouts or keys (v1 loaded a whole
 * scout board per scout). Agrees with v1's per-scout loadScoutBoard path key for key (pinned in a test).
 */
export async function scoutCandidatesMany(
  sb: SupabaseClient,
  input: { entryId: number; keys: readonly string[] },
  deps: { loadCatalog?: () => Promise<AdvancementCatalog> } = {}
): Promise<ScoutCandidatesManyResult> {
  if (!input || !Number.isInteger(input.entryId) || !Array.isArray(input.keys) || !input.keys.every((k) => typeof k === 'string')) {
    return { ok: false, error: 'Malformed request' };
  }
  const meeting = await loadMeetingById(sb, input.entryId);
  if (!meeting || meeting.closed) return { ok: false, error: 'This meeting has no picks.' };
  const [catalog, scouts, topics, intents] = await Promise.all([
    (deps.loadCatalog ?? loadAdvancementCatalog)(),
    loadBoardScouts(sb),
    loadFocusTopics(sb, meeting.entryId),
    loadIntents(sb, meeting.entryId)
  ]);
  const progress = await loadScoutProgress(sb, scouts.map((s) => s.scoutId));
  const picks = await loadEffectivePicks(sb, meeting, scouts, catalog, progress);
  const focus = focusPicks(topics, catalog);
  // B6: the likely rule's facts (a mix's members, each scout's open badges), from what is already loaded.
  const members = new Map(topics.map((t) => [t.key, t.members]));
  const badges = catalog.meritBadges.map((m) => ({ id: m.id, name: m.name }));
  const trees = rankTrees(catalog.rankRequirements);

  const byKey = new Map<string, ScoutCandidate[]>(input.keys.map((k) => [k, []]));
  const eligible: EligibleScout[] = [];
  for (const scout of scouts) {
    const intent = intents.get(scout.personId) ?? null;
    if (intent === 'not_coming') continue;
    const p = progress.get(scout.scoutId) ?? { rankCodes: new Set<string>(), mbProgress: [] };
    eligible.push({ personId: scout.personId, scoutId: scout.scoutId, name: boardName(scout.name), currentRank: scout.currentRank, picked: (picks.get(scout.personId)?.picks ?? []).map((x) => x.key) });
    // The pick list as loadScoutBoard builds it for a candidate check (no others, teachers or freeform).
    const pickable = pickableKeys(
      buildPickList({
        currentRank: scout.currentRank,
        ranks: catalog.ranks,
        rankReqs: catalog.rankRequirements,
        mbs: catalog.meritBadges,
        mbProgress: p.mbProgress,
        rankCodes: p.rankCodes,
        focus
      })
    );
    const mine = picks.get(scout.personId)?.picks ?? [];
    const awardedMbs = new Set(p.mbProgress.filter((m) => m.awarded).map((m) => m.mb_id));
    const badgesInProgress = new Set(p.mbProgress.filter((m) => !m.awarded && m.has_any_req).map((m) => m.mb_id));
    for (const [key, list] of byKey) {
      if (!pickable.has(key)) continue;
      const picked = mine.some((x) => x.key === key);
      const unfinished = key.startsWith('fg:') ? unfinishedMembers(members.get(key) ?? [], { currentRank: scout.currentRank, ranks: catalog.ranks, trees, rankCodes: p.rankCodes, awardedMbs, badges }) : undefined;
      const fit = likelyFit({ currentRank: scout.currentRank, unfinished, badgesInProgress }, key, catalog.ranks, badges);
      const badge = !key.startsWith('fg:') && fit.likely && !rankOfKey(key, catalog.ranks) ? (badgeName(key, badges) ?? null) : null;
      list.push({
        personId: scout.personId,
        name: boardName(scout.name),
        note: `${intent ? INTENT_LABEL[intent] : 'no answer'}${picked ? ' · picked it' : ''}`,
        ticked: !picked,
        currentRank: scout.currentRank,
        likely: fit.likely,
        covers: fit.covers,
        badge,
        intent,
        isTest: scout.isTest === true
      });
    }
  }
  for (const list of byKey.values()) list.sort((a, b) => Number(b.ticked) - Number(a.ticked) || a.name.localeCompare(b.name));
  const titles = new Map(topics.filter((t) => t.title).map((t) => [t.key, t.title as string]));
  return { ok: true, byKey, eligible, words: { titles, members: new Map(topics.map((t) => [t.key, [...t.members]])) } };
}

/** Emails in flight at once. */
export const REMINDER_BATCH = 5;
/** No new batch starts after this; the planner page's maxDuration is 60 s. */
export const REMINDER_TIME_BUDGET_MS = 40_000;
/** One email that hasn't answered by now counts as not sent, so the last batch still ends inside maxDuration. */
export const REMINDER_EMAIL_TIMEOUT_MS = 15_000;

export const EMAIL_TIMED_OUT = Symbol('timed out');
/** sendEmail, or EMAIL_TIMED_OUT once the timeout passes (the late send may still land; its row is gone by then). */
export function sendEmailWithin(ms: number, opts: Parameters<typeof sendEmail>[0]): Promise<Awaited<ReturnType<typeof sendEmail>> | typeof EMAIL_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof EMAIL_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(EMAIL_TIMED_OUT), ms);
  });
  return Promise.race([sendEmail(opts), timeout]).finally(() => clearTimeout(timer));
}
