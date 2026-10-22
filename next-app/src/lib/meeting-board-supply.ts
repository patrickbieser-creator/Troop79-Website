/**
 * The teacher side of the meeting board (Phase 2 of Plans/Meeting-Requests-And-Teaching-Offers.md): loaders and
 * writers. Server-only: every function takes the service-role client. The rules are in lib/meeting-board-teach (pure).
 *
 * Who can be a teacher: an adult (person_directory tab leader/adult, in the picker: the same definition the RPCs use)
 * or a Junior Leader (an active scout for whom canOfferToTeach holds on the meeting date). Their skills, counselor
 * badges and, for Junior Leaders, ledger codes are read fresh on every load, so a skill saved on "What I can teach"
 * counts on the next page view.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import { canOfferToTeach } from '@/lib/can-offer-to-teach';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { JuniorLeaderOverride } from '@/lib/participant-class';
import { loadIntents, loadScoutProgress, type BoardMeeting, type BoardScoutRow, type BoardWriteResult } from '@/lib/meeting-board';
import { fmtDate } from '@/lib/format-date';
import { NOT_PLANNABLE, SM_CONFERENCE_CODES } from '@/lib/rank-calculus';
import { rankTrees, topicWords, type TopicPart, type TopicWords } from '@/lib/meeting-board-picklist';
import { boardName, effectiveIntent, summarizeBoard, type Intent } from '@/lib/meeting-board-shared';
import { matchBoard, type MatchResult } from '@/lib/meeting-board-match';
import { loadFocusTopics, type FocusTopic } from '@/lib/meeting-focus-db';
import {
  assessTeacher,
  flagText,
  matchSupply,
  topicSkill,
  weeksAsked,
  teacherName,
  teachersFor,
  type SkillOfferRow,
  type SupplyInput,
  type TeachContext,
  type TeacherKind,
  type TeacherPerson,
  type TopicTeacherRow
} from '@/lib/meeting-board-teach';

type Catalog = Pick<AdvancementCatalog, 'ranks' | 'rankRequirements' | 'skills'>;

export function teachContext(catalog: Catalog): TeachContext {
  return {
    ranks: catalog.ranks,
    rankReqs: catalog.rankRequirements,
    trees: rankTrees(catalog.rankRequirements),
    youthTeachable: new Map(catalog.skills.map((s) => [s.id, s.youth_teachable]))
  };
}

type ScoutRow = { id: string; person_id: number; current_rank: string | null; graduation_year: number | null; junior_leader_override: JuniorLeaderOverride };

/**
 * Teachers by person: everyone who may teach ('all', for the admin's "who can teach it") or just these people. A person
 * who may not teach (a younger scout, a guest, someone deactivated) is absent, unless `evenIfIneligible` (for people
 * who already hold rows): then they come back with eligible: false, so their rows can still be seen and taken back.
 */
export async function loadTeacherPeople(
  sb: SupabaseClient,
  who: 'all' | readonly number[],
  onDate: string,
  catalog: Pick<AdvancementCatalog, 'ranks'>,
  opts: { evenIfIneligible?: boolean } = {}
): Promise<Map<number, TeacherPerson>> {
  const out = new Map<number, TeacherPerson>();
  if (who !== 'all' && !who.length) return out;
  const ids = who === 'all' ? null : [...new Set(who)];
  const [dir, scouts] = await Promise.all([
    fetchAllRows<{ person_id: number }>((from, to) => {
      let q = sb.from('person_directory').select('person_id').in('tab', ['leader', 'adult']).eq('in_picker', true);
      if (ids) q = q.in('person_id', ids);
      return q.order('person_id').range(from, to);
    }),
    fetchAllRows<ScoutRow>((from, to) => {
      let q = sb.from('scouts').select('id, person_id, current_rank, graduation_year, junior_leader_override').eq('active', true).not('person_id', 'is', null);
      if (ids) q = q.in('person_id', ids);
      return q.order('id').range(from, to);
    })
  ]);
  const adults = new Set(dir.map((d) => d.person_id));
  const sortOf = new Map(catalog.ranks.map((r) => [r.id, r.sort_order]));
  const firstClass = sortOf.get('first-class') ?? Number.MAX_SAFE_INTEGER;
  const juniors = scouts.filter(
    (s) =>
      !adults.has(s.person_id) &&
      canOfferToTeach({
        rankSortOrder: s.current_rank ? (sortOf.get(s.current_rank) ?? null) : null,
        firstClassSortOrder: firstClass,
        graduationYear: s.graduation_year,
        override: s.junior_leader_override,
        onDate
      })
  );
  const kindOf = new Map<number, TeacherKind>([...[...adults].map((id) => [id, 'adult'] as const), ...juniors.map((s) => [s.person_id, 'junior'] as const)]);
  const ineligible = new Set<number>();
  if (opts.evenIfIneligible && ids) {
    const activeScouts = new Set(scouts.map((s) => s.person_id));
    for (const id of ids) {
      if (kindOf.has(id)) continue;
      kindOf.set(id, activeScouts.has(id) ? 'junior' : 'adult');
      ineligible.add(id);
    }
  }
  const keep = [...kindOf.keys()];
  if (!keep.length) return out;

  const [people, skills, counselors, progress] = await Promise.all([
    fetchAllRows<{ id: number; display_name: string; first_name: string | null; last_name: string | null; gender: string | null }>((from, to) =>
      sb.from('people').select('id, display_name, first_name, last_name, gender').in('id', keep).order('id').range(from, to)
    ),
    fetchAllRows<{ person_id: number; skill_id: string }>((from, to) =>
      sb.from('teaching_skills').select('person_id, skill_id').in('person_id', keep).order('person_id').order('skill_id').range(from, to)
    ),
    fetchAllRows<{ person_id: number; mb_id: string }>((from, to) =>
      sb.from('merit_badge_counselors').select('person_id, mb_id').in('person_id', keep).order('id').range(from, to)
    ),
    loadScoutProgress(sb, juniors.map((s) => s.id))
  ]);
  const skillsOf = new Map<number, Set<string>>();
  for (const s of skills) skillsOf.set(s.person_id, (skillsOf.get(s.person_id) ?? new Set()).add(s.skill_id));
  const badgesOf = new Map<number, Set<string>>();
  for (const c of counselors) badgesOf.set(c.person_id, (badgesOf.get(c.person_id) ?? new Set()).add(c.mb_id));
  const juniorOf = new Map(juniors.map((s) => [s.person_id, s]));
  for (const p of people) {
    const kind = kindOf.get(p.id)!;
    const j = juniorOf.get(p.id);
    out.set(p.id, {
      personId: p.id,
      kind,
      displayName: p.display_name,
      firstName: p.first_name,
      lastName: p.last_name,
      gender: p.gender,
      skills: skillsOf.get(p.id) ?? new Set(),
      counselorFor: badgesOf.get(p.id) ?? new Set(),
      currentRank: j?.current_rank ?? null,
      rankCodes: j ? (progress.get(j.id)?.rankCodes ?? new Set()) : new Set(),
      ...(ineligible.has(p.id) ? { eligible: false } : {})
    });
  }
  return out;
}

export interface SupplyRows {
  topicTeachers: (TopicTeacherRow & { entryId: number; enteredByPersonId: number | null })[];
  skillOffers: (SkillOfferRow & { entryId: number })[];
  /** Freeform topics on these boards, with their titles. */
  freeform: { entryId: number; key: string; title: string }[];
}

/** Teacher rows, skill offers and freeform topics on these meetings. */
export async function loadSupplyRows(sb: SupabaseClient, entryIds: readonly number[]): Promise<SupplyRows> {
  if (!entryIds.length) return { topicTeachers: [], skillOffers: [], freeform: [] };
  const ids = [...new Set(entryIds)];
  const [t, o, f] = await Promise.all([
    sb.from('meeting_topic_teachers').select('calendar_entry_id, person_id, note, entered_by_person_id, created_at, meeting_topics(topic_key)').in('calendar_entry_id', ids).order('created_at'),
    sb.from('meeting_teaching_offers').select('calendar_entry_id, person_id, skill_id, note, created_at').in('calendar_entry_id', ids).order('created_at'),
    sb.from('meeting_topics').select('calendar_entry_id, topic_key, title').in('calendar_entry_id', ids).eq('kind', 'freeform')
  ]);
  const err = t.error ?? o.error ?? f.error;
  if (err) throw new Error(err.message);
  type TRow = { calendar_entry_id: number; person_id: number; note: string | null; entered_by_person_id: number | null; meeting_topics: { topic_key: string } | { topic_key: string }[] | null };
  const keyOf = (r: TRow) => (Array.isArray(r.meeting_topics) ? r.meeting_topics[0] : r.meeting_topics)?.topic_key ?? null;
  return {
    topicTeachers: ((t.data ?? []) as unknown as TRow[])
      .filter((r) => keyOf(r))
      .map((r) => ({ entryId: r.calendar_entry_id, key: keyOf(r)!, personId: r.person_id, note: r.note, enteredByPersonId: r.entered_by_person_id })),
    skillOffers: ((o.data ?? []) as { calendar_entry_id: number; person_id: number; skill_id: string; note: string | null }[]).map((r) => ({
      entryId: r.calendar_entry_id,
      personId: r.person_id,
      skillId: r.skill_id,
      note: r.note
    })),
    freeform: ((f.data ?? []) as { calendar_entry_id: number; topic_key: string; title: string }[]).map((r) => ({ entryId: r.calendar_entry_id, key: r.topic_key, title: r.title }))
  };
}

export interface TeachBoard {
  ctx: TeachContext;
  /** Everyone with a row on this meeting, plus anyone asked for (the viewer; 'all' on admin). */
  people: Map<number, TeacherPerson>;
  /** This meeting's supply (Can't-make-it teachers in notComing). */
  supply: SupplyInput;
  /** Explicit answers of the teachers in `people`. */
  intents: Map<number, Intent>;
  /** Who wants what for this meeting (Can't-make-it scouts and "later" picks left out). */
  demand: Map<string, number[]>;
  freeform: { key: string; title: string }[];
  /** Freeform and focus-group titles by key (topicWords' titles). */
  freeformTitles: Map<string, string>;
  /** What a planner seeded on this meeting (P3), seeded topics only. */
  focus: FocusTopic[];
  /** Focus groups' items by key (topicWords' members). */
  members: Map<string, string[]>;
  match: ReturnType<typeof matchSupply>;
}

/** The teacher side of one meeting against its demand. `include`: extra people to load as teachers ('all' for admin). */
export async function loadTeachBoard(
  sb: SupabaseClient,
  meeting: Pick<BoardMeeting, 'entryId' | 'date'>,
  catalog: Catalog,
  board: readonly BoardScoutRow[],
  include: 'all' | readonly number[] = []
): Promise<TeachBoard> {
  const [rows, topics] = await Promise.all([loadSupplyRows(sb, [meeting.entryId]), loadFocusTopics(sb, meeting.entryId)]);
  const focus = topics.filter((t) => t.seeded);
  const withRows = [...rows.topicTeachers.map((r) => r.personId), ...rows.skillOffers.map((r) => r.personId)];
  const people = await loadTeacherPeople(sb, include === 'all' ? 'all' : [...withRows, ...include], meeting.date, catalog);
  // Someone who signed up and no longer qualifies still shows with their rows (eligible: false), so they or a leader
  // can take them back.
  const missing = [...new Set(withRows)].filter((id) => !people.has(id));
  if (missing.length) for (const [id, p] of await loadTeacherPeople(sb, missing, meeting.date, catalog, { evenIfIneligible: true })) people.set(id, p);
  const intents = await loadIntents(sb, meeting.entryId, [...people.keys()]);
  const ctx = teachContext(catalog);
  const supply: SupplyInput = {
    topicTeachers: rows.topicTeachers,
    skillOffers: rows.skillOffers,
    people,
    notComing: new Set([...intents].filter(([, it]) => it === 'not_coming').map(([id]) => id)),
    ctx
  };
  const { demand } = summarizeBoard(board);
  const freeform = rows.freeform.map((f) => ({ key: f.key, title: f.title }));
  // Titles and members for every focus group on the board, seeded or kept for its picks after an unseed.
  const titles = new Map([...freeform.map((f) => [f.key, f.title] as const), ...topics.filter((f) => f.title).map((f) => [f.key, f.title!] as const)]);
  return { ctx, people, supply, intents, demand, freeform, freeformTitles: titles, focus, members: new Map(topics.map((f) => [f.key, f.members])), match: matchSupply(demand, supply) };
}

/**
 * The live match for one meeting (Phase 3a): the board and its teacher side through the pure matcher. Scouts' ledger
 * codes are read fresh (closest-to-completion tie-break, the engine's placement of "Not sure yet" scouts). Recomputed
 * on every load and poll; nothing is stored.
 */
export async function loadLiveMatch(
  sb: SupabaseClient,
  meeting: Pick<BoardMeeting, 'date'>,
  board: readonly BoardScoutRow[],
  teach: Pick<TeachBoard, 'supply' | 'intents'>
): Promise<MatchResult> {
  const inPlay = board.filter((s) => {
    const it = effectiveIntent(s.intent, s.picks);
    return it === 'coming' || it === 'undecided';
  });
  const progress = await loadScoutProgress(sb, inPlay.map((s) => s.scoutId));
  return matchBoard({
    meetingDate: meeting.date,
    scouts: inPlay.map((s) => ({
      personId: s.personId,
      currentRank: s.currentRank,
      rankCodes: progress.get(s.scoutId)?.rankCodes ?? new Set<string>(),
      intent: s.intent,
      picks: s.picks
    })),
    supply: teach.supply,
    teacherIntents: teach.intents
  });
}

/** The meeting has a published agenda (the member page then says the match as the plan, not "so far"). */
export async function isAgendaPublished(sb: SupabaseClient, entryId: number): Promise<boolean> {
  const { count, error } = await sb
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .eq('calendar_entry_id', entryId)
    .eq('status', 'published')
    .is('archived_at', null);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/**
 * The scout pick list's "Teacher: Mr. Vest" tag for every key a scout could see: the first teacher coming for it,
 * named as scouts see them. Covers committed topics and every requirement a skill offer reaches.
 */
export function teacherTags(t: TeachBoard): Map<string, string> {
  const keys = new Set<string>([
    ...t.supply.topicTeachers.map((r) => r.key),
    ...t.ctx.rankReqs.filter((r) => r.parent_id == null).map((r) => `${r.rank_id}-${r.code}`)
  ]);
  const out = new Map<string, string>();
  for (const key of keys) {
    const first = teachersFor(key, t.supply)[0];
    const p = first ? t.people.get(first.personId) : undefined;
    if (p) out.set(key, teacherName(p, 'scout'));
  }
  return out;
}

// ── writers (one RPC each; the RPC holds the locks, the cap, and re-checks who may act) ─────────────────────────────

export interface TeachWriter {
  /** The teacher. */
  personId: number;
  /** Who is entering it. */
  actorPersonId: number;
  /** A leader entering on someone's behalf; the caller has checked the capability. */
  leader: boolean;
}

const base = (w: TeachWriter) => ({ p_person: w.personId, p_actor: w.actorPersonId, p_leader: w.leader });
/** The RPCs' own messages are written for people; anything else (a constraint, a dropped connection) is not shown raw. */
const KNOWN = /^(You can only sign up|Teaching is for|There’s no teaching|That meeting|That isn’t something|Junior Leaders can’t|Pick at least one date)/;
export const SAVE_FAILED = 'Couldn’t save that. Try again.';
export function sanitizeRpcError(message: string): string {
  return KNOWN.test(message) ? message : SAVE_FAILED;
}
const done = (error: { message: string } | null): BoardWriteResult => (error ? { ok: false, error: sanitizeRpcError(error.message) } : { ok: true });

/** "I'll teach this" (one entry) or a standing requirement / freeform offer (several). key null + title = freeform. */
export async function teachTopic(sb: SupabaseClient, w: TeachWriter, entryIds: readonly number[], what: { key: string } | { title: string }, note: string | null): Promise<BoardWriteResult> {
  const { error } = await sb.rpc('meeting_teach_topic', {
    ...base(w),
    p_entries: [...entryIds],
    p_topic_key: 'key' in what ? what.key : null,
    p_title: 'title' in what ? what.title : null,
    p_note: note
  });
  return done(error);
}

/**
 * The planner's Assign: teachTopic for the scouts waiting on it. A new sign-up is marked for_picks, so it comes off
 * when no scout picks the topic any more (lib/meeting-board removeMeetingPick). Someone already teaching it keeps
 * their own sign-up unmarked.
 */
export async function assignForPicks(sb: SupabaseClient, w: TeachWriter, entryId: number, key: string): Promise<BoardWriteResult> {
  const mine = () =>
    sb.from('meeting_topic_teachers').select('topic_id, meeting_topics!inner(topic_key)').eq('calendar_entry_id', entryId).eq('person_id', w.personId).eq('meeting_topics.topic_key', key);
  const before = await mine();
  if (before.error) return { ok: false, error: SAVE_FAILED };
  const taught = await teachTopic(sb, w, [entryId], { key }, null);
  if (!taught.ok || (before.data ?? []).length) return taught;
  const after = await mine();
  const topicIds = ((after.data ?? []) as { topic_id: number }[]).map((r) => r.topic_id);
  if (after.error || !topicIds.length) return { ok: false, error: SAVE_FAILED };
  const { error } = await sb.from('meeting_topic_teachers').update({ for_picks: true }).eq('person_id', w.personId).in('topic_id', topicIds);
  return done(error);
}

export async function unteachTopic(sb: SupabaseClient, w: TeachWriter, entryId: number, key: string): Promise<BoardWriteResult> {
  const { error } = await sb.rpc('meeting_unteach_topic', { ...base(w), p_entry: entryId, p_topic_key: key });
  return done(error);
}

export async function offerSkill(sb: SupabaseClient, w: TeachWriter, entryIds: readonly number[], skillId: string, note: string | null): Promise<BoardWriteResult> {
  const { error } = await sb.rpc('meeting_offer_skill', { ...base(w), p_entries: [...entryIds], p_skill_id: skillId, p_note: note });
  return done(error);
}

export async function withdrawSkillOffer(sb: SupabaseClient, w: TeachWriter, entryId: number, skillId: string): Promise<BoardWriteResult> {
  const { error } = await sb.rpc('meeting_withdraw_skill_offer', { ...base(w), p_entry: entryId, p_skill_id: skillId });
  return done(error);
}

// ── the member page's teach section ──────────────────────────────────────────────────────────────────────────────

/** One thing this person is teaching on this meeting: a topic, or a broad skill offer. */
export interface TeachItem {
  kind: 'topic' | 'offer';
  /** The topic key, or the skill id for an offer. */
  key: string;
  label: string;
  /** 'Tenderfoot 4a', 'Merit badge', 'Offered this week', or 'Any requirement' for a skill offer. */
  sub: string;
  /** Scouts asking for it this meeting (an offer: across every requirement it covers). */
  scouts: number;
  names: string[];
  /** "sign-off needs a counselor", "not in what you've said you can teach". */
  flags: string[];
  note: string | null;
  /** Other upcoming dates this person has the same commitment on ('Nov 8'). */
  alsoOn: string[];
  /** A topic's sub-requirements (T-4) and expected minutes (T-3); absent for a skill offer. */
  parts?: TopicPart[];
  minutes?: number | null;
}

/** A topic scouts asked for this meeting, as one teacher sees it. */
export interface WantedItem {
  key: string;
  label: string;
  codeLabel: string;
  scouts: number;
  names: string[];
  weeks: number;
  /** Who is already teaching it. Empty = wanted, no teacher. */
  teachers: string[];
  qualified: boolean;
  flags: string[];
  /** A Junior Leader and an adults-only skill: no button. */
  refused: boolean;
  /** Sub-requirements (T-4) and expected minutes to teach it (T-3). */
  parts?: TopicPart[];
  minutes?: number | null;
}

export interface TeachView {
  personId: number;
  kind: TeacherKind;
  /** The explicit answer (a Junior Leader answers in the scout section; this is the same row). */
  intent: Intent | null;
  /** Commitments on this meeting, topics and skill offers together (the 2-cap). */
  count: number;
  items: TeachItem[];
  /** Wanted-no-teacher first, then the rest by how many scouts ask. Excludes what this person already teaches. */
  wanted: WantedItem[];
  hasSkills: boolean;
  /** False for someone who no longer qualifies: they see and remove what they hold, and add nothing. */
  canAdd: boolean;
}

/** The teach section of someone with nothing left to show (they no longer qualify and hold no rows). */
export function emptyTeachView(personId: number): TeachView {
  return { personId, kind: 'adult', intent: null, count: 0, items: [], wanted: [], hasSkills: false, canAdd: false };
}

export interface OfferChoices {
  /** Skills this person holds that they may offer (a Junior Leader: youth-teachable only). */
  skills: { id: string; name: string }[];
  /** Rank requirements a teacher can take on at a meeting, by rank. */
  requirements: { rank: string; options: { key: string; label: string }[] }[];
  /** Upcoming rank boards, soonest first; `entryId` of this meeting is checked by default. */
  dates: { entryId: number; label: string }[];
}

const short = (date: string) => fmtDate(date, { year: false });

/** The teach section for one person on one meeting, or null when they can't teach. */
export async function loadTeachView(
  sb: SupabaseClient,
  meeting: Pick<BoardMeeting, 'entryId' | 'date'>,
  catalog: Pick<AdvancementCatalog, 'ranks' | 'rankRequirements' | 'meritBadges' | 'skills'> & Partial<Pick<AdvancementCatalog, 'meritBadgeRequirements'>>,
  personId: number,
  opts: { board: readonly BoardScoutRow[]; upcoming: readonly Pick<BoardMeeting, 'entryId' | 'date'>[]; teach?: TeachBoard }
): Promise<TeachView | null> {
  const t = opts.teach ?? (await loadTeachBoard(sb, meeting, catalog, opts.board, [personId]));
  const me = t.people.get(personId) ?? (await loadTeacherPeople(sb, [personId], meeting.date, catalog)).get(personId);
  if (!me) return null;
  const canAdd = me.eligible !== false;
  const audience = me.kind === 'junior' ? 'scout' : 'admin';
  const nameOfScout = new Map(opts.board.map((s) => [s.personId, boardName(s.name)]));
  const firstAsked = new Map<string, string[]>();
  for (const s of opts.board) for (const p of s.picks) firstAsked.set(p.key, [...(firstAsked.get(p.key) ?? []), p.firstAskedOn]);
  const words = (key: string): TopicWords =>
    topicWords(key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, t.freeformTitles, { mbReqs: catalog.meritBadgeRequirements, members: t.members }) ?? { label: key, codeLabel: '', kind: 'rank', parts: [], minutes: null };
  const scoutsFor = (key: string) => (t.demand.get(key) ?? []).map((id) => nameOfScout.get(id) ?? '').filter(Boolean).sort();
  const skillName = new Map(catalog.skills.map((s) => [s.id, s.name]));

  // Other dates: the same topic or skill on any other upcoming meeting.
  const others = opts.upcoming.filter((m) => m.entryId !== meeting.entryId);
  const otherRows = await loadSupplyRows(sb, others.map((m) => m.entryId));
  const dateOf = new Map(others.map((m) => [m.entryId, m.date]));
  const alsoTopic = (key: string) =>
    otherRows.topicTeachers.filter((r) => r.personId === personId && r.key === key).map((r) => dateOf.get(r.entryId)!).sort().map(short);
  const alsoSkill = (skillId: string) =>
    otherRows.skillOffers.filter((r) => r.personId === personId && r.skillId === skillId).map((r) => dateOf.get(r.entryId)!).sort().map(short);

  const items: TeachItem[] = [];
  const mineKeys = new Set<string>();
  for (const r of t.supply.topicTeachers.filter((x) => x.personId === personId)) {
    mineKeys.add(r.key);
    const w = words(r.key);
    const names = scoutsFor(r.key);
    items.push({
      kind: 'topic',
      key: r.key,
      label: w.label,
      sub: w.codeLabel,
      scouts: names.length,
      names,
      flags: flagText(assessTeacher(me, r.key, t.ctx).flags, 'self'),
      note: r.note,
      alsoOn: alsoTopic(r.key),
      parts: w.parts,
      minutes: w.minutes
    });
  }
  for (const o of t.supply.skillOffers.filter((x) => x.personId === personId)) {
    const covered = [...t.demand.keys()].filter((k) => (t.match.teachers.get(k) ?? []).some((x) => x.personId === personId && x.via === 'offer') && topicSkill(k, t.ctx.ranks, t.ctx.rankReqs) === o.skillId);
    const names = [...new Set(covered.flatMap(scoutsFor))].sort();
    items.push({ kind: 'offer', key: o.skillId, label: skillName.get(o.skillId) ?? o.skillId, sub: 'Any requirement', scouts: names.length, names, flags: [], note: o.note, alsoOn: alsoSkill(o.skillId) });
  }

  const wanted: WantedItem[] = (canAdd ? [...t.demand.keys()] : [])
    .filter((key) => !mineKeys.has(key))
    .map((key) => {
      const w = words(key);
      const a = assessTeacher(me, key, t.ctx);
      const teachers = (t.match.teachers.get(key) ?? []).map((x) => t.people.get(x.personId)).filter((p): p is TeacherPerson => !!p).map((p) => teacherName(p, audience));
      const names = scoutsFor(key);
      return { key, label: w.label, codeLabel: w.codeLabel, scouts: names.length, names, weeks: weeksAsked(firstAsked.get(key) ?? [], meeting.date), teachers, qualified: a.qualified, flags: flagText(a.flags, 'self'), refused: a.refused, parts: w.parts, minutes: w.minutes };
    })
    .sort((a, b) => Number(a.teachers.length > 0) - Number(b.teachers.length > 0) || b.scouts - a.scouts || a.codeLabel.localeCompare(b.codeLabel));

  return {
    personId,
    kind: me.kind,
    intent: t.intents.get(personId) ?? (await loadIntents(sb, meeting.entryId, [personId])).get(personId) ?? null,
    count: items.length,
    items,
    wanted,
    hasSkills: me.skills.size > 0,
    canAdd
  };
}

/** What "Offer something" can offer, for one teacher. */
export function offerChoices(
  me: Pick<TeacherPerson, 'kind' | 'skills'>,
  catalog: Pick<AdvancementCatalog, 'ranks' | 'rankRequirements' | 'skills'>,
  upcoming: readonly Pick<BoardMeeting, 'entryId' | 'date' | 'closed'>[]
): OfferChoices {
  const youth = new Map(catalog.skills.map((s) => [s.id, s.youth_teachable]));
  const skills = catalog.skills.filter((s) => me.skills.has(s.id) && (me.kind === 'adult' || s.youth_teachable)).map((s) => ({ id: s.id, name: s.name }));
  const ranks = [...catalog.ranks].sort((a, b) => a.sort_order - b.sort_order).filter((r) => OFFER_RANKS.has(r.id));
  const requirements = ranks
    .map((r) => ({
      rank: r.display_name,
      options: catalog.rankRequirements
        .filter((q) => q.rank_id === r.id && q.parent_id == null && q.venue !== 'outing' && q.code.toLowerCase() !== 'bor')
        .filter((q) => !NOT_PLANNABLE.has(`${r.id}-${q.code}`) && !SM_CONFERENCE_CODES.has(`${r.id}-${q.code}`))
        .filter((q) => me.kind === 'adult' || !q.skill_id || youth.get(q.skill_id) !== false)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((q) => ({ key: `${r.id}-${q.code}`, label: `${q.code} ${q.label}` }))
    }))
    .filter((g) => g.options.length);
  return { skills, requirements, dates: upcoming.filter((m) => !m.closed).map((m) => ({ entryId: m.entryId, label: short(m.date) })) };
}

/** The ranks a requirement offer lists: the ones taught at regular meetings (Scout through First Class). */
const OFFER_RANKS = new Set(['scout', 'tenderfoot', 'second-class', 'first-class']);
/** How many upcoming meetings a standing offer can list. */
export const OFFER_DATES = 6;

/** A teacher's answer and commitment count on one meeting (the /member card's line). */
export async function loadTeacherState(sb: SupabaseClient, entryId: number, personId: number): Promise<{ intent: Intent | null; count: number }> {
  const [t, o, intents] = await Promise.all([
    sb.from('meeting_topic_teachers').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', entryId).eq('person_id', personId),
    sb.from('meeting_teaching_offers').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', entryId).eq('person_id', personId),
    loadIntents(sb, entryId, [personId])
  ]);
  if (t.error ?? o.error) throw new Error((t.error ?? o.error)!.message);
  return { intent: intents.get(personId) ?? null, count: (t.count ?? 0) + (o.count ?? 0) };
}
