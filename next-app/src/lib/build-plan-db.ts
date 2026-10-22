/**
 * Build a Plan's server reads for the slices its writes return (Plans/Build-A-Plan.md; qa-lead B1 follow-up 5).
 * Server-only: the service-role client; the caller gates.
 *
 * Who teaches a just-added offering, the way the board counts it (teachersFor: people signed up for the topic, plus
 * a matching skill offer from someone qualified, minus anyone who said they can't come). Cheap in the common case:
 * two reads (the topic's teachers, the meeting's skill offers) and nothing more when neither has anyone; only when
 * someone could be teaching it are the catalog, those people and their answers read.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { loadIntents } from '@/lib/meeting-board';
import { loadTeacherPeople, teachContext } from '@/lib/meeting-board-supply';
import { teacherName, teachersFor, topicSkill, type SupplyInput } from '@/lib/meeting-board-teach';

type TeacherRow = { person_id: number; meeting_topics: { topic_key: string } | { topic_key: string }[] | null };
const keyOf = (r: TeacherRow) => (Array.isArray(r.meeting_topics) ? r.meeting_topics[0] : r.meeting_topics)?.topic_key ?? null;

/** Each key's teachers' names ('Maria L'), as the plan row shows them. A key nobody teaches maps to []. */
export async function teachersOfKeys(sb: SupabaseClient, meeting: { entryId: number; date: string }, keys: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map(keys.map((k) => [k, [] as string[]]));
  if (!keys.length) return out;
  const [t, o] = await Promise.all([
    sb.from('meeting_topic_teachers').select('person_id, meeting_topics!inner(topic_key)').eq('calendar_entry_id', meeting.entryId).in('meeting_topics.topic_key', [...keys]),
    sb.from('meeting_teaching_offers').select('person_id, skill_id').eq('calendar_entry_id', meeting.entryId)
  ]);
  const err = t.error ?? o.error;
  if (err) throw new Error(err.message);
  const topicTeachers = ((t.data ?? []) as unknown as TeacherRow[]).flatMap((r) => (keyOf(r) ? [{ key: keyOf(r)!, personId: r.person_id, note: null }] : []));
  const offers = ((o.data ?? []) as { person_id: number; skill_id: string }[]).map((r) => ({ personId: r.person_id, skillId: r.skill_id, note: null }));
  if (!topicTeachers.length && !offers.length) return out;

  const catalog = await loadAdvancementCatalog();
  const ctx = teachContext(catalog);
  const skills = new Set(keys.map((k) => topicSkill(k, ctx.ranks, ctx.rankReqs)).filter((s): s is string => s != null));
  const skillOffers = offers.filter((x) => skills.has(x.skillId));
  const ids = [...new Set([...topicTeachers.map((x) => x.personId), ...skillOffers.map((x) => x.personId)])];
  if (!ids.length) return out;
  const [people, intents] = await Promise.all([loadTeacherPeople(sb, ids, meeting.date, catalog, { evenIfIneligible: true }), loadIntents(sb, meeting.entryId, ids)]);
  const supply: SupplyInput = {
    topicTeachers,
    skillOffers,
    people,
    notComing: new Set([...intents].filter(([, it]) => it === 'not_coming').map(([id]) => id)),
    ctx
  };
  for (const key of keys) {
    out.set(
      key,
      teachersFor(key, supply).flatMap((x) => {
        const p = people.get(x.personId);
        return p ? [teacherName(p, 'admin')] : [];
      })
    );
  }
  return out;
}
