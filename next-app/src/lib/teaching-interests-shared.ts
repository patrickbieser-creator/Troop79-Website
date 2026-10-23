/**
 * Build a Plan B10c/B10d: the client-safe half of lib/teaching-interests (constants, types, the short words). No
 * server imports: the picker and the Invite tab's list import this; the server lib re-exports it.
 */
import { shortRequirement } from '@/lib/rank-abbrev';

export const INTEREST_NOTE_MAX = 140;
export const INTEREST_SUBMIT_CAP = 15;
export const INTEREST_ACTIVE_CAP = 40;
export const INTEREST_NOW_CAP = 5;
export const INTEREST_SEARCH_MAX = 80;
export const NEW_TALENT_DAYS = 30;

export type InterestKind = 'rank' | 'mb' | 'badge';

/** One catalog item: a top-level requirement or a whole merit badge ('mb:<id>'). */
export interface InterestHit {
  key: string;
  kind: InterestKind;
  sourceName: string;
  code: string | null;
  label: string;
}

export interface InterestPick {
  key: string;
  note: string | null;
}

/** The item the short way: 'Ten 3a · Square Knot use', 'First Aid 2 · Preparing…', 'First Aid (whole badge)'. */
export function interestShort(h: Pick<InterestHit, 'kind' | 'sourceName' | 'code' | 'label'>): string {
  if (h.kind === 'badge') return `${h.sourceName} (whole badge)`;
  return shortRequirement(`${h.sourceName} ${h.code ?? ''}`, h.label);
}

/** A whole badge can be recorded as an interest but never offered for this Sunday (it isn't one class). */
export const canTeachNow = (key: string) => !key.startsWith('mb:');

export interface TalentItem {
  id: number;
  short: string;
  note: string | null;
  createdAt: string;
}

export interface TalentGroup {
  personId: number;
  name: string;
  items: TalentItem[];
}
