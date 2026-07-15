/**
 * Scoutbook bulk-upload export — generates the pipe-delimited advancement
 * file Scoutbook's admin upload accepts, for merit badge and rank awards
 * recorded in a date range.
 *
 * AdvancementID mapping: merit_badges.scoutbook_id / ranks.scoutbook_id,
 * both corrected against scoutbook_merit_badge_reference (see that table's
 * memory note — trust it over any other source without re-verifying).
 */

import type { createAdminClient } from '@/lib/supabase/server';

export interface ScoutbookExportRow {
  memberId: string;
  firstName: string;
  lastName: string;
  scoutName: string;
  advancementType: 'meritbadge' | 'rank';
  advancementLabel: string;
  advancementId: string;
  dateCompleted: string;
}

export interface ScoutbookExcludedRow {
  scoutName: string;
  what: string;
  date: string;
  reason: string;
}

export interface ScoutbookExportResult {
  rows: ScoutbookExportRow[];
  excluded: ScoutbookExcludedRow[];
}

export async function loadScoutbookExport(
  supabase: ReturnType<typeof createAdminClient>,
  from: string,
  to: string
): Promise<ScoutbookExportResult> {
  const [ledgerRes, scoutsRes, mbsRes, ranksRes] = await Promise.all([
    supabase
      .from('ledger_active')
      .select('scout_id, kind, code, label, date')
      .in('kind', ['merit_badge_award', 'rank_award'])
      .gte('date', from)
      .lte('date', to)
      .order('date'),
    supabase.from('scouts').select('id, first_name, last_name, display_name, bsa_member_id'),
    supabase.from('merit_badges').select('id, name, scoutbook_id'),
    supabase.from('ranks').select('id, display_name, scoutbook_id')
  ]);

  const scoutMap = new Map(
    ((scoutsRes.data ?? []) as {
      id: string;
      first_name: string;
      last_name: string;
      display_name: string;
      bsa_member_id: string | null;
    }[]).map((s) => [s.id, s])
  );
  const mbMap = new Map(
    ((mbsRes.data ?? []) as { id: string; name: string; scoutbook_id: string | null }[]).map((m) => [
      m.id,
      m
    ])
  );
  const rankMap = new Map(
    ((ranksRes.data ?? []) as { id: string; display_name: string; scoutbook_id: string | null }[]).map(
      (r) => [r.id, r]
    )
  );

  const rows: ScoutbookExportRow[] = [];
  const excluded: ScoutbookExcludedRow[] = [];

  for (const entry of (ledgerRes.data ?? []) as {
    scout_id: string;
    kind: 'merit_badge_award' | 'rank_award';
    code: string;
    label: string | null;
    date: string;
  }[]) {
    const scout = scoutMap.get(entry.scout_id);
    const scoutName = scout?.display_name ?? entry.scout_id;

    if (!scout) {
      excluded.push({ scoutName, what: entry.label ?? entry.code, date: entry.date, reason: 'Scout record not found' });
      continue;
    }
    if (!scout.bsa_member_id) {
      excluded.push({
        scoutName,
        what: entry.label ?? entry.code,
        date: entry.date,
        reason: 'No BSA Member ID on file (add one in Lookups → Scouts)'
      });
      continue;
    }

    let advancementType: 'meritbadge' | 'rank';
    let advancementLabel: string;
    let advancementId: string | null | undefined;

    if (entry.kind === 'merit_badge_award') {
      const mbId = entry.code.startsWith('MB:') ? entry.code.slice(3) : entry.code;
      const mb = mbMap.get(mbId);
      advancementType = 'meritbadge';
      advancementLabel = mb?.name ?? entry.label ?? mbId;
      advancementId = mb?.scoutbook_id;
    } else {
      const rank = rankMap.get(entry.code);
      advancementType = 'rank';
      advancementLabel = rank?.display_name ?? entry.label ?? entry.code;
      advancementId = rank?.scoutbook_id;
    }

    if (!advancementId) {
      excluded.push({
        scoutName,
        what: advancementLabel,
        date: entry.date,
        reason: 'No confirmed Scoutbook ID for this ' + (advancementType === 'rank' ? 'rank' : 'merit badge')
      });
      continue;
    }

    rows.push({
      memberId: scout.bsa_member_id,
      firstName: scout.first_name,
      lastName: scout.last_name,
      scoutName,
      advancementType,
      advancementLabel,
      advancementId,
      dateCompleted: entry.date
    });
  }

  return { rows, excluded };
}

/** Builds the pipe-delimited upload file — matches Scoutbook's expected
 *  column order exactly (verified against a real working sample export). */
export function formatScoutbookFile(rows: ScoutbookExportRow[]): string {
  const header =
    'MemberID|FirstName|MiddleName|LastName|AdvancementType|AdvancementID|Version|DateCompleted|DateApproved|DateAwarded';
  const lines = rows.map((r) => {
    const ts = `${r.dateCompleted} 00:00:00`;
    return [r.memberId, r.firstName, '', r.lastName, r.advancementType, r.advancementId, '', ts, ts, ''].join(
      '|'
    );
  });
  return [header, ...lines].join('\r\n') + '\r\n';
}
