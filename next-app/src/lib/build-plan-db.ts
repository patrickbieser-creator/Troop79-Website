/**
 * Build a Plan's server reads for the slices its writes return (Plans/Build-A-Plan.md; qa-lead B1 follow-up 5; B2).
 * Server-only: the service-role client; the caller gates.
 *
 * teachersOfKeys: who teaches an offering, the way the board counts it (teachersFor: people signed up for the topic,
 * then a matching skill offer from someone qualified, minus anyone who said they can't come). Cheap in the common case:
 * two reads (the topics' teachers with their names, the meeting's skill offers) plus one for answers when anyone turned
 * up; the catalog and the offerers' records are read only when there are skill offers on the meeting.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { loadIntents } from '@/lib/meeting-board';
import { boardName } from '@/lib/meeting-board-shared';
import { loadTeacherPeople, teachContext } from '@/lib/meeting-board-supply';
import { assessTeacher, teacherName, topicSkill } from '@/lib/meeting-board-teach';
import { itemView } from '@/lib/meeting-focus-db';
import { loadPlannerLists } from '@/lib/people-lists';
import { teacherChoices, type TeacherChoice } from '@/lib/build-plan';
import type { FocusSetItem } from '@/lib/meeting-focus';

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
type TeacherRow = { person_id: number; meeting_topics: One<{ topic_key: string }>; people: One<{ display_name: string }> };

/** Each key's teachers' names ('Maria L'), as the plan row shows them. A key nobody teaches maps to []. */
export async function teachersOfKeys(sb: SupabaseClient, meeting: { entryId: number; date: string }, keys: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map(keys.map((k) => [k, [] as string[]]));
  if (!keys.length) return out;
  const [t, o] = await Promise.all([
    sb
      .from('meeting_topic_teachers')
      .select('person_id, meeting_topics!inner(topic_key), people!meeting_topic_teachers_person_id_fkey(display_name)')
      .eq('calendar_entry_id', meeting.entryId)
      .in('meeting_topics.topic_key', [...keys])
      .order('created_at'),
    sb.from('meeting_teaching_offers').select('person_id, skill_id').eq('calendar_entry_id', meeting.entryId).order('created_at')
  ]);
  const err = t.error ?? o.error;
  if (err) throw new Error(err.message);
  const topicTeachers = ((t.data ?? []) as unknown as TeacherRow[]).flatMap((r) => {
    const key = one(r.meeting_topics)?.topic_key;
    return key ? [{ key, personId: r.person_id, name: boardName(one(r.people)?.display_name ?? '') }] : [];
  });
  const offers = (o.data ?? []) as { person_id: number; skill_id: string }[];

  // Skill offers count only for a rank requirement whose skill they offer, from someone who qualifies.
  const offerNames = new Map<string, { personId: number; name: string }[]>();
  if (offers.length) {
    const catalog = await loadAdvancementCatalog();
    const ctx = teachContext(catalog);
    const skillOf = new Map(keys.map((k) => [k, topicSkill(k, ctx.ranks, ctx.rankReqs)]));
    const wanted = new Set([...skillOf.values()].filter((s): s is string => s != null));
    const matching = offers.filter((x) => wanted.has(x.skill_id));
    if (matching.length) {
      const people = await loadTeacherPeople(sb, [...new Set(matching.map((x) => x.person_id))], meeting.date, catalog);
      for (const key of keys) {
        const skill = skillOf.get(key);
        const list: { personId: number; name: string }[] = [];
        for (const x of matching) {
          const p = people.get(x.person_id);
          if (x.skill_id !== skill || !p || list.some((l) => l.personId === p.personId) || !assessTeacher(p, key, ctx).qualified) continue;
          list.push({ personId: p.personId, name: teacherName(p, 'admin') });
        }
        offerNames.set(key, list);
      }
    }
  }
  const ids = [...new Set([...topicTeachers.map((x) => x.personId), ...[...offerNames.values()].flat().map((x) => x.personId)])];
  if (!ids.length) return out;
  const intents = await loadIntents(sb, meeting.entryId, ids);
  const coming = (id: number) => intents.get(id) !== 'not_coming';
  for (const key of keys) {
    const seen = new Set<number>();
    const names: string[] = [];
    for (const x of [...topicTeachers.filter((r) => r.key === key), ...(offerNames.get(key) ?? [])]) {
      if (seen.has(x.personId) || !coming(x.personId)) continue;
      seen.add(x.personId);
      names.push(x.name);
    }
    out.set(key, names);
  }
  return out;
}

/** A mix on a meeting: its focus set, the class's name and the requirements it holds there (with their words). */
export async function loadMixOnMeeting(sb: SupabaseClient, entryId: number, key: string): Promise<{ setId: number; name: string; items: FocusSetItem[] } | null> {
  const { data, error } = await sb
    .from('meeting_topics')
    .select('title, focus_set_id, meeting_topic_members(item_key, position)')
    .eq('calendar_entry_id', entryId)
    .eq('topic_key', key)
    .eq('kind', 'focus_group')
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { title: string | null; focus_set_id: number | null; meeting_topic_members: { item_key: string; position: number }[] | null } | null;
  if (!row || row.focus_set_id == null) return null;
  const catalog = await loadAdvancementCatalog();
  const items = [...(row.meeting_topic_members ?? [])].sort((a, b) => a.position - b.position).map((m) => itemView(m.item_key, catalog));
  return { setId: row.focus_set_id, name: row.title ?? '', items };
}

/** Who could teach an offering, for its Edit: everyone in the teacher pool, qualified first with why (teacherChoices). */
export async function loadTeacherChoices(sb: SupabaseClient, meeting: { entryId: number; date: string }, key: string): Promise<TeacherChoice[]> {
  const [catalog, lists, current, members] = await Promise.all([
    loadAdvancementCatalog(),
    loadPlannerLists(),
    sb.from('meeting_topic_teachers').select('person_id, meeting_topics!inner(topic_key)').eq('calendar_entry_id', meeting.entryId).eq('meeting_topics.topic_key', key),
    key.startsWith('fg:')
      ? sb.from('meeting_topic_members').select('item_key, meeting_topics!inner(calendar_entry_id, topic_key)').eq('meeting_topics.calendar_entry_id', meeting.entryId).eq('meeting_topics.topic_key', key)
      : null
  ]);
  const err = current.error ?? members?.error;
  if (err) throw new Error(err.message);
  const people = await loadTeacherPeople(sb, 'all', meeting.date, catalog, { pool: lists.pool });
  // Someone already teaching it who isn't in the pool any more still shows, so they can be taken off.
  const teaching = new Set(((current.data ?? []) as { person_id: number }[]).map((r) => r.person_id));
  const missing = [...teaching].filter((id) => !people.has(id));
  if (missing.length) for (const [id, p] of await loadTeacherPeople(sb, missing, meeting.date, catalog, { evenIfIneligible: true })) people.set(id, p);
  return teacherChoices({
    people: [...people.values()],
    key,
    members: ((members?.data ?? []) as { item_key: string }[]).map((m) => m.item_key),
    ctx: teachContext(catalog),
    skillNames: new Map(catalog.skills.map((s) => [s.id, s.name])),
    badges: catalog.meritBadges.map((m) => ({ id: m.id, name: m.name })),
    teaching
  });
}
