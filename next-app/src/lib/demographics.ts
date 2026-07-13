/**
 * Derived demographics — age, grade, and YPT status are never stored, only
 * computed (same philosophy as current_rank and youth-leader status).
 */

import { centralToday } from '@/lib/dates';

/** Whole years old on `onDate` (yyyy-mm-dd), or null without a birthdate. */
export function ageOn(birthdate: string | null, onDate: string = centralToday()): number | null {
  if (!birthdate) return null;
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

/** The calendar year the CURRENT school year ends in (Aug 1 rollover). */
export function schoolYearEnd(onDate: string = centralToday()): number {
  const [y, m] = onDate.split('-').map(Number);
  return m >= 8 ? y + 1 : y;
}

/**
 * Grade derived from graduation year: 12 in the class's final school year.
 * Returns e.g. 7 for a 7th grader, 0 for kindergarten, 13+ = graduated.
 */
export function gradeFromGradYear(gradYear: number | null, onDate?: string): number | null {
  if (!gradYear) return null;
  return 12 - (gradYear - schoolYearEnd(onDate));
}

/** Inverse: the graduation year for a scout currently in `grade`. */
export function gradYearFromGrade(grade: number, onDate?: string): number {
  return schoolYearEnd(onDate) + (12 - grade);
}

export function gradeLabel(grade: number | null): string {
  if (grade === null) return '—';
  if (grade <= 0) return 'K';
  if (grade > 12) return 'Graduated';
  const suffix = grade === 1 ? 'st' : grade === 2 ? 'nd' : grade === 3 ? 'rd' : 'th';
  return `${grade}${suffix} grade`;
}

export const SWIM_CLASS_LABEL: Record<string, string> = {
  swimmer: 'Swimmer',
  beginner: 'Beginner',
  nonswimmer: 'Non-swimmer'
};

export type YptStatus = 'current' | 'expiring' | 'expired' | 'missing';

/** YPT certification runs two years; 'expiring' = within 60 days of lapse. */
export function yptStatus(completed: string | null, onDate: string = centralToday()): {
  status: YptStatus;
  expires: string | null;
} {
  if (!completed) return { status: 'missing', expires: null };
  const [y, m, d] = completed.split('-').map(Number);
  const expires = `${y + 2}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (expires <= onDate) return { status: 'expired', expires };
  const soon = new Date(Date.UTC(y + 2, m - 1, d));
  soon.setUTCDate(soon.getUTCDate() - 60);
  const soonIso = soon.toISOString().slice(0, 10);
  return { status: onDate >= soonIso ? 'expiring' : 'current', expires };
}
