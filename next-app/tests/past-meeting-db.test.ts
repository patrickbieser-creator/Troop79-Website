import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { fetchAdvancementCatalog } from '../src/lib/advancement-catalog';
import { fetchPeopleLists, fetchMeetingLabels } from '../src/lib/people-lists';
import { loadLeafCodes, loadThisWeekData } from '../src/lib/this-week-db';
import { loadHappenedRows, loadPastMeetings, loadRankAwards } from '../src/lib/past-meeting-db';
import { buildThisWeek } from '../src/lib/this-week';

/**
 * A past meeting is shown as of the night itself (Patrick, 2026-11-09): advancement dated ON or after the meeting
 * is not yet done. Ledger rows here are test-owned (ids deleted after each test) on Charlie Walters (D03), the test
 * scout, with codes no catalog requirement uses.
 */
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const SCOUT = 'D03';
let ledgerIds: number[] = [];

afterEach(async () => {
  if (ledgerIds.length) await sb.from('ledger_entries').delete().in('id', ledgerIds);
  ledgerIds = [];
});

async function ledger(rows: { kind: string; code: string; date: string }[]) {
  const { data, error } = await sb
    .from('ledger_entries')
    .insert(rows.map((r) => ({ ...r, scout_id: SCOUT, label: 'ZZVITEST past meeting' })))
    .select('id');
  if (error) throw new Error(`fixture ledger: ${error.message}`);
  ledgerIds.push(...(data ?? []).map((r) => r.id as number));
}

describe('loadLeafCodes before a date', () => {
  it('LeafCodes_KeepARequirementSignedOffBeforeTheMeeting', async () => {
    await ledger([{ kind: 'rank_requirement', code: 'tenderfoot-zzvitest-a', date: '2026-11-01' }]);
    const p = await loadLeafCodes(sb, [SCOUT], '2026-11-08');
    expect(p.get(SCOUT)?.rankCodes.has('tenderfoot-zzvitest-a')).toBe(true);
  });

  it('LeafCodes_LeaveOutARequirementSignedOffOnTheMeetingDay', async () => {
    await ledger([{ kind: 'rank_requirement', code: 'tenderfoot-zzvitest-b', date: '2026-11-08' }]);
    const p = await loadLeafCodes(sb, [SCOUT], '2026-11-08');
    expect(p.get(SCOUT)?.rankCodes.has('tenderfoot-zzvitest-b')).toBe(false);
  });

  it('LeafCodes_CountABadgeAwardedBeforeTheMeetingAsEarned', async () => {
    await ledger([{ kind: 'merit_badge_award', code: 'MB:zzvitest-badge', date: '2026-10-01' }]);
    const p = await loadLeafCodes(sb, [SCOUT], '2026-11-08');
    expect(p.get(SCOUT)?.awardedMbs?.has('zzvitest-badge')).toBe(true);
  });

  it('LeafCodes_DoNotCountABadgeAwardedAfterTheMeeting', async () => {
    await ledger([{ kind: 'merit_badge_award', code: 'MB:zzvitest-badge2', date: '2026-11-20' }]);
    const p = await loadLeafCodes(sb, [SCOUT], '2026-11-08');
    expect(p.get(SCOUT)?.awardedMbs?.has('zzvitest-badge2') ?? false).toBe(false);
  });
});

describe('loadPastMeetings', () => {
  it('PastMeetings_AreBeforeTodayNewestFirst', async () => {
    const labels = await fetchMeetingLabels(sb);
    const past = await loadPastMeetings(sb, '2026-11-09', labels);
    const dates = past.map((m) => m.date);
    expect(dates.every((d) => d < '2026-11-09') && dates.join() === [...dates].sort().reverse().join()).toBe(true);
  });
});

describe('loadThisWeekData as of the meeting', () => {
  it('ThisWeekAsOf_PlacesEveryActiveScoutExactlyOnce_ForAPastMeeting', async () => {
    const [catalog, lists, labels] = await Promise.all([fetchAdvancementCatalog(sb as never), fetchPeopleLists(sb), fetchMeetingLabels(sb)]);
    const [meeting] = await loadPastMeetings(sb, '2026-11-09', labels);
    const data = await loadThisWeekData(sb, meeting, lists, catalog, { asOfMeeting: true });
    const tw = buildThisWeek(data.input);
    // A Stations night seats its scouts in rotation groups instead of the checklist sections.
    const ids = [...tw.sections.flatMap((s) => s.rows.map((r) => r.personId)), ...(tw.rotation?.on && !tw.rotation.problem ? tw.rotation.groups.flatMap((g) => g.members.map((m) => m.personId)) : [])];
    expect([ids.length, new Set(ids).size]).toEqual([lists.pool.scouts.length, lists.pool.scouts.length]);
  });
});

/** A fake PostgREST: an awaited query without .range() gets PostgREST's first 1000 rows, as the real API caps it;
 *  .range(from, to) pages. qa-lead 2026-11-09: both past-meeting ledger reads must page. */
function cappedClient(rowsByTable: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const rows = rowsByTable[table] ?? [];
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'lt', 'like', 'order']) q[m] = () => q;
      q.range = (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      q.then = (ok: (v: unknown) => unknown) => ok({ data: rows.slice(0, 1000), error: null });
      return q;
    }
  } as never;
}

describe('past-meeting reads page past 1000 rows', () => {
  it('RankAwards_ReadEveryRow_PastTheCap', async () => {
    const rows = Array.from({ length: 1005 }, (_, i) => ({ scout_id: `S${i}`, code: 'scout', date: '2026-01-01' }));
    expect((await loadRankAwards(cappedClient({ reportable_ledger: rows }), ['S1'])).length).toBe(1005);
  });

  it('HappenedRows_ReadEverySignOff_PastTheCap', async () => {
    const rows = Array.from({ length: 1005 }, (_, i) => ({ scout_id: `S${i}`, kind: 'rank_requirement', code: 'tenderfoot-1' }));
    const got = await loadHappenedRows(cappedClient({ reportable_ledger: rows, event_attendance: [] }), { entryId: 1, date: '2026-11-08' });
    expect(got.ledger.length).toBe(1005);
  });
});
