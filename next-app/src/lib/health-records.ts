/**
 * Health records: the pure rules (Plans/Health-Forms.md). Client-safe: kinds, pages, expiry and status, shared by
 * the parent screen, the upload action and the tests. Nothing here touches a file or the database.
 */

export const HEALTH_KINDS = ['bsa_ab', 'bsa_c', 'insurance', 'immunization'] as const;
export type HealthKind = (typeof HEALTH_KINDS)[number];

export interface HealthKindDef {
  label: string;
  /** Asked before the first page: which two dates start the 12 months. */
  dated: boolean;
  maxPages: number;
  /** Fixed page names (an insurance card's two sides); null = "Page n". */
  pageNames: readonly string[] | null;
  /** Counts toward "everything we need": the BSA form and the insurance card (Patrick, 2026-11-12). */
  required: boolean;
  hint: string;
}

export const HEALTH_KIND: Record<HealthKind, HealthKindDef> = {
  bsa_ab: { label: 'BSA health form, Parts A and B', dated: true, maxPages: 6, pageNames: null, required: true, hint: 'Every page, signed by a parent. Needed for every outing.' },
  bsa_c: { label: 'BSA health form, Part C', dated: true, maxPages: 4, pageNames: null, required: false, hint: 'The physician’s exam. Only for summer camp and trips over 72 hours.' },
  insurance: { label: 'Insurance card', dated: false, maxPages: 2, pageNames: ['Front', 'Back'], required: true, hint: 'Both sides.' },
  immunization: { label: 'Immunization record', dated: false, maxPages: 4, pageNames: null, required: false, hint: 'Only when it isn’t already on the BSA form.' }
};

export function isHealthKind(v: unknown): v is HealthKind {
  return typeof v === 'string' && (HEALTH_KINDS as readonly string[]).includes(v);
}

export function pageName(kind: HealthKind, page: number): string {
  return HEALTH_KIND[kind].pageNames?.[page - 1] ?? `Page ${page}`;
}

export function validPage(kind: HealthKind, page: number): boolean {
  return Number.isInteger(page) && page >= 1 && page <= HEALTH_KIND[kind].maxPages;
}

/** What a browser sends that we keep: a phone photo, a screenshot, or a PDF. */
export const HEALTH_CONTENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type HealthContentType = (typeof HEALTH_CONTENT_TYPES)[number];

/** Vercel caps a request body near 4.5 MB; the phone shrinks photos under this before sending. */
export const HEALTH_MAX_BYTES = 3_500_000;

/** The file's real type from its first bytes: the name and the browser's say-so are never trusted. */
export function sniffHealthType(b: Uint8Array): HealthContentType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'application/pdf';
  return null;
}

/** Why a file can't be kept, in the family's words; null when it can. */
export function healthFileProblem(b: Uint8Array): string | null {
  if (b.length === 0) return 'That file is empty. Choose it again.';
  if (b.length > HEALTH_MAX_BYTES) return 'That file is too big. Photograph each page instead of sending one large PDF.';
  if (!sniffHealthType(b)) return 'That isn’t a photo or a PDF. Take a photo of the page, or choose a JPEG, PNG or PDF.';
  return null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day `months` later, clamped to the month's last day (Jan 31 + 1 month = Feb 28). Pure string math. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** The 12 months start from the LATER of the parent's and the doctor's signatures (Patrick, 2026-11-12). */
export function effectiveOn(parentSigned: string | null | undefined, doctorSigned: string | null | undefined): string | null {
  const dates = [parentSigned, doctorSigned].filter((d): d is string => typeof d === 'string' && ISO.test(d));
  return dates.length ? dates.sort().at(-1)! : null;
}

export function expiresOn(effective: string | null): string | null {
  return effective ? addMonths(effective, 12) : null;
}

/** Why a signature date can't be used; null when it can (or is blank). */
export function signedDateProblem(iso: string | null | undefined, today: string): string | null {
  if (!iso) return null;
  if (!ISO.test(iso) || iso < '1900-01-01') return 'Pick the date on the form.';
  if (iso > today) return 'Pick a date that isn’t in the future.';
  return null;
}

export type HealthStatus = 'on_file' | 'expires_soon' | 'expired' | 'missing';

export const HEALTH_STATUS_LABEL: Record<HealthStatus, string> = { on_file: 'On file', expires_soon: 'Expires soon', expired: 'Expired', missing: 'Missing' };

/** Days before the end of the 12 months that a form reads "Expires soon". */
export const EXPIRES_SOON_DAYS = 60;

export interface HealthPage {
  id: string;
  personId: number;
  kind: HealthKind;
  page: number;
  contentType: string;
  uploadedAt: string;
  effectiveOn: string | null;
  expiresOn: string | null;
}

function daysBetween(a: string, b: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/** One document's standing from its pages. An insurance card needs both sides to be on file. */
export function kindStatus(kind: HealthKind, pages: readonly HealthPage[], today: string): HealthStatus {
  const mine = pages.filter((p) => p.kind === kind);
  if (mine.length === 0) return 'missing';
  if (HEALTH_KIND[kind].pageNames && mine.length < HEALTH_KIND[kind].pageNames!.length) return 'missing';
  const expires = mine.map((p) => p.expiresOn).filter((d): d is string => !!d).sort()[0];
  if (expires) {
    if (expires < today) return 'expired';
    if (daysBetween(today, expires) <= EXPIRES_SOON_DAYS) return 'expires_soon';
  }
  return 'on_file';
}

const WORST: readonly HealthStatus[] = ['missing', 'expired', 'expires_soon', 'on_file'];

/** A person's standing: the worst of the documents every outing needs. */
export function personStatus(pages: readonly HealthPage[], today: string): HealthStatus {
  const each = HEALTH_KINDS.filter((k) => HEALTH_KIND[k].required).map((k) => kindStatus(k, pages, today));
  return WORST.find((s) => each.includes(s)) ?? 'on_file';
}

/** The next free page of a document, or null when it is full. */
export function nextPage(kind: HealthKind, pages: readonly HealthPage[]): number | null {
  const used = new Set(pages.filter((p) => p.kind === kind).map((p) => p.page));
  for (let n = 1; n <= HEALTH_KIND[kind].maxPages; n += 1) if (!used.has(n)) return n;
  return null;
}
