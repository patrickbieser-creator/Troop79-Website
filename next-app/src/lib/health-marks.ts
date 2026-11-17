/**
 * The admin Health Forms check marks and status ordering (Plans/Admin-Health-Forms.md, R1/R2). Plain module, client
 * safe: the server page builds rows with it and the list sorts by its ranks. Status rules themselves stay in
 * lib/health-records (kindStatus, healthStanding); this only turns them into a mark, its words and a sort rank.
 */
import { fmtDate } from '@/lib/format-date';
import { HEALTH_KIND, kindStatus, type HealthKind, type HealthPage, type HealthStanding } from '@/lib/health-records';

export type HealthMarkTone = 'ok' | 'soon' | 'bad' | 'none';

export interface HealthMarkValue {
  /** What the cell shows: ✓, ✓ Soon, Expired, Missing, or — for an optional document that isn't there. */
  text: string;
  tone: HealthMarkTone;
  /** Full words for a screen reader: "Parts A and B: expired Oct 1, 2026". */
  srText: string;
  /** Worst first: Missing 0, Expired 1, Soon 2, ✓ 3, — 4. */
  rank: number;
}

/** Short names for the column headers and screen-reader text. */
export const HEALTH_MARK_NAME: Record<HealthKind, string> = {
  bsa_ab: 'Parts A and B',
  bsa_c: 'Part C',
  insurance: 'Insurance card',
  immunization: 'Immunization record'
};

/** `inBsaForm`: a named leader's "the immunizations are on the BSA form" (Plans/Admin-Health-Record-Sheet-Redesign.md,
 *  decision 16). An immunization record with nothing on file then reads ✓ BSA; it is never red either way. */
export function healthMark(kind: HealthKind, pages: readonly HealthPage[], today: string, opts: { inBsaForm?: boolean } = {}): HealthMarkValue {
  const mine = pages.filter((p) => p.kind === kind);
  if (kind === 'immunization' && mine.length === 0 && opts.inBsaForm) return { text: '✓ BSA', tone: 'ok', srText: `${HEALTH_MARK_NAME[kind]}: in the BSA form`, rank: 3 };
  const status = kindStatus(kind, mine, today);
  const name = HEALTH_MARK_NAME[kind];
  const expires = mine.map((p) => p.expiresOn).filter((d): d is string => !!d).sort()[0];
  const until = expires ? ` until ${fmtDate(expires)}` : '';
  switch (status) {
    case 'on_file':
      return { text: '✓', tone: 'ok', srText: `${name}: on file${until}`, rank: 3 };
    case 'expires_soon':
      return { text: '✓ Soon', tone: 'soon', srText: `${name}: expires ${fmtDate(expires)}`, rank: 2 };
    case 'expired':
      return { text: 'Expired', tone: 'bad', srText: `${name}: expired ${fmtDate(expires)}`, rank: 1 };
    default:
      return HEALTH_KIND[kind].required
        ? { text: 'Missing', tone: 'bad', srText: `${name}: missing`, rank: 0 }
        : { text: '—', tone: 'none', srText: `${name}: not on file`, rank: 4 };
  }
}

/** Status column sort: worst first. */
export const HEALTH_STANDING_RANK: Record<HealthStanding, number> = {
  missing: 0,
  expired: 1,
  expires_soon: 2,
  ready: 3,
  complete: 4
};
