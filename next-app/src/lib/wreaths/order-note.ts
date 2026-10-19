/**
 * Wreath sale — the order note (Plans/Wreath-Sale.md, "Tune-up feedback (2026-10-19)", W-1). One shared, editable note
 * on an order, for the troop only: the treasurer (finance.manage, checked by the admin action) and the family of the
 * scout the order is credited to (the viewer's resolveFamilyScope, the scout-entered orders rule, D-379) read and edit
 * it. Last edit wins and is shown as "Edited by Dan V · Oct 19".
 *
 * Never customer-facing: lib/wreaths/public.ts loadConfirmation names its columns and leaves these out, and no email
 * builder is handed them. The note never touches the money, so a card-paid order takes one too.
 *
 * This module is pure (client components use the stamp and the cap); the write is ./order-note-save.ts.
 */
import { fmtDate } from '@/lib/format-date';
import type { ScoutEntryViewer } from './place-order';

export const ORDER_NOTE_MAX = 500;

export type OrderNoteActor = { kind: 'admin'; personId: number | null; label: string } | { kind: 'family'; viewer: ScoutEntryViewer };

export type OrderNoteResult = { ok: true } | { ok: false; code: 'forbidden' | 'invalid'; error: string };

/** Trimmed text, 0..500 characters; empty clears the note. */
export function parseOrderNote(raw: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, note: null };
  if (typeof raw !== 'string') return { ok: false, error: 'That note isn’t text.' };
  const t = raw.trim();
  if (t.length > ORDER_NOTE_MAX) return { ok: false, error: `That note is ${t.length} characters. ${ORDER_NOTE_MAX} at most.` };
  return { ok: true, note: t || null };
}

/** "Dan V": how a note's last editor is named (first name, last initial). */
export function noteAuthorName(first: string | null, last: string | null): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim().charAt(0).toUpperCase();
  return [f, l].filter(Boolean).join(' ') || 'A leader';
}

/** "Edited by Dan V · Oct 19" (the editor is optional: a treasurer with no people row is just "Edited Oct 19"). */
export function noteStamp(by: string | null, at: string | null): string {
  const when = at ? fmtDate(at, { year: false }) : null;
  if (by && when) return `Edited by ${by} · ${when}`;
  if (by) return `Edited by ${by}`;
  return when ? `Edited ${when}` : '';
}

