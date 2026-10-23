/**
 * The audit row for an invite answered from its link (Patrick, 2026-10-22): the actor is the person the link went to,
 * by name ("Dana Walsh (invite link)", personId kept), and the summary says who answered, for whom when a parent
 * answers for a scout, what (the short way, lib/rank-abbrev) and the meeting's date:
 *   "Patrick B said yes to teaching Star 6 · Cyber Chip (Oct 25)"
 *   "Dana W said not this week for Anjali S: Ten 3a · Square Knot (Oct 25)"
 * Server-only. Never throws: a lookup that fails falls back to what the answer itself carries.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditActor, AuditEntry } from '@/lib/audit';
import { loadAdvancementCatalog, type AdvancementCatalog } from '@/lib/advancement-catalog';
import { fmtDate } from '@/lib/format-date';
import { boardName } from '@/lib/meeting-board-shared';
import { topicWords } from '@/lib/meeting-board-picklist';
import { loadTopicWordsFor } from '@/lib/meeting-focus-db';
import { shortRequirement } from '@/lib/rank-abbrev';
import type { RespondResult } from '@/lib/meeting-invites-db';

export interface InviteAnswerFacts {
  kind: 'teach' | 'pick';
  response: 'accepted' | 'declined';
  /** Who answered (the link's recipient), short: "Dana W". */
  recipient: string;
  /** Whom it is about (the teacher, or the scout), short. */
  invitee: string;
  /** The recipient answered for themselves (a teacher, or a scout's own link). */
  self: boolean;
  /** "Ten 3a · Square Knot". */
  topic: string;
  /** "Oct 25". */
  day: string;
}

export function inviteAnswerSummary(a: InviteAnswerFacts): string {
  const said = a.response === 'accepted' ? 'said yes' : 'said not this week';
  if (a.kind === 'teach') return `${a.recipient} ${said} to teaching ${a.topic} (${a.day})`;
  return a.self ? `${a.recipient} ${said} to ${a.topic} (${a.day})` : `${a.recipient} ${said} for ${a.invitee}: ${a.topic} (${a.day})`;
}

type Answered = Extract<RespondResult, { ok: true }>;

export async function inviteAnswerAudit(
  sb: SupabaseClient,
  res: Answered,
  deps: { loadCatalog?: () => Promise<AdvancementCatalog> } = {}
): Promise<{ actor: AuditActor; entry: AuditEntry }> {
  let recipientName = '';
  let inviteeName = '';
  let topic = '';
  let day = '';
  try {
    const { data: inv } = await sb.from('meeting_invites').select('calendar_entry_id, topic_key').eq('id', res.inviteId).maybeSingle();
    const row = inv as { calendar_entry_id: number; topic_key: string } | null;
    const [{ data: people }, entry, catalog, own] = await Promise.all([
      sb.from('people').select('id, display_name').in('id', [res.recipientId, res.inviteeId]),
      row ? sb.from('calendar_entries').select('entry_date').eq('id', row.calendar_entry_id).maybeSingle() : Promise.resolve({ data: null }),
      row ? (deps.loadCatalog ?? loadAdvancementCatalog)() : Promise.resolve(null),
      row ? loadTopicWordsFor(sb, row.calendar_entry_id, row.topic_key) : Promise.resolve(null)
    ]);
    const nameOf = new Map(((people ?? []) as { id: number; display_name: string }[]).map((p) => [p.id, p.display_name]));
    recipientName = nameOf.get(res.recipientId) ?? '';
    inviteeName = nameOf.get(res.inviteeId) ?? '';
    const date = (entry.data as { entry_date: string } | null)?.entry_date;
    day = date ? fmtDate(date, { year: false }) : '';
    if (row && catalog && own) {
      const words = topicWords(row.topic_key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, own.titles, { mbReqs: catalog.meritBadgeRequirements, members: own.members });
      topic = words ? (words.kind === 'ff' ? words.label : shortRequirement(words.codeLabel, words.label)) : row.topic_key;
    }
  } catch (e) {
    console.error('invite answer audit lookup failed:', e);
  }
  const facts: InviteAnswerFacts = {
    kind: res.kind,
    response: res.response === 'accepted' ? 'accepted' : 'declined',
    recipient: boardName(recipientName) || 'Someone',
    invitee: boardName(inviteeName) || 'a scout',
    self: res.recipientId === res.inviteeId,
    topic: topic || (res.kind === 'teach' ? 'a topic' : 'a requirement'),
    day: day || 'the meeting'
  };
  return {
    actor: { personId: res.recipientId, label: `${recipientName || 'Someone'} (invite link)` },
    entry: {
      area: 'meeting',
      action: res.response === 'accepted' ? 'invite.accept' : 'invite.decline',
      entityType: 'meeting_invite',
      entityId: res.inviteId,
      summary: inviteAnswerSummary(facts)
    }
  };
}
