import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Webelos on the roster — the guard. A Webelos's advancement is TRACKED on
 * the ledger but must never be REPORTED, so every advancement report, export,
 * public count and meeting-planner read goes through `reportable_ledger`
 * (ledger_active minus Webelos rows), never `ledger_active` or a filtered
 * `ledger_entries` select.
 *
 * The rule, for a new reader: REPORT / EXPORT / PUBLIC / PLANNER →
 * reportable_ledger, and add the file below. Data entry and editing (Fast
 * Entry, the ledger page, audits' write actions, merges, dedup, code-rename
 * checks) and a person's OWN record (their library progress, teaching
 * skills) stay on ledger_active / ledger_entries — those must see a Webelos's
 * rows. Writes to ledger_entries (update/insert/delete) are fine anywhere.
 *
 * Grep-shaped, not a parser: flags any `from('ledger_active')`, and any
 * `from('ledger_entries')` chained straight onto `.select(`.
 */

const SRC = path.join(__dirname, '..', 'src');

const REPORT_READERS = [
  'lib/advancement-report.ts',
  'lib/court-of-honor.ts',
  'lib/scoutbook-export.ts',
  'lib/scout-detail.ts',
  'lib/has-needs-db.ts',
  'lib/meeting-board.ts',
  'lib/this-week-db.ts',
  'lib/past-meeting-db.ts',
  'lib/meeting-suggest/load-input.ts',
  'app/admin/(workspace)/advancement/audits/audit-input.ts',
  'app/admin/(workspace)/advancement/dashboard/advancement-overview.tsx',
  'app/admin/(workspace)/advancement/meetings/report/page.tsx',
  'app/(public)/library/mb/[mbId]/page.tsx',
  'app/(public)/library/rank/[rankId]/[code]/page.tsx',
  'app/admin/(workspace)/advancement/records/page.tsx'
];

function rawLedgerReads(src: string): string[] {
  const hits: string[] = [];
  if (/from\(\s*['"]ledger_active['"]\s*\)/.test(src)) hits.push('ledger_active');
  if (/from\(\s*['"]ledger_entries['"]\s*\)\s*(?:\/\/[^\n]*\n\s*)*\.select\(/.test(src)) hits.push('ledger_entries select');
  return hits;
}

describe('report readers use reportable_ledger', () => {
  it('EveryListedReader_Exists', () => {
    const missing = REPORT_READERS.filter((f) => !fs.existsSync(path.join(SRC, f)));
    expect(missing).toEqual([]);
  });

  it('NoReportReader_ReadsLedgerActiveOrLedgerEntries', () => {
    const offenders: string[] = [];
    for (const f of REPORT_READERS) {
      const p = path.join(SRC, f);
      if (!fs.existsSync(p)) continue;
      for (const hit of rawLedgerReads(fs.readFileSync(p, 'utf8'))) offenders.push(`${f}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it('EveryListedReader_ReadsReportableLedger', () => {
    const silent = REPORT_READERS.filter((f) => {
      const p = path.join(SRC, f);
      return fs.existsSync(p) && !fs.readFileSync(p, 'utf8').includes("from('reportable_ledger')");
    });
    expect(silent).toEqual([]);
  });
});
