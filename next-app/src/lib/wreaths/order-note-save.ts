/**
 * Wreath sale — saving the order note (W-1; the rules and wording are ./order-note.ts). Service-role client passed in;
 * the admin action has already passed requireCapability('finance.manage'), and a family viewer comes from the session
 * (lib/wreaths/scout-entry-viewer.ts), never from the request. The family's write is conditional in the database as
 * well (credited to someone in the viewer's scope, still placed), so the check and the write cannot drift apart.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditAs, type AuditActor } from '@/lib/audit';
import { parseOrderNote, type OrderNoteActor, type OrderNoteResult } from './order-note';

const FORBIDDEN: OrderNoteResult = { ok: false, code: 'forbidden', error: 'You can change notes only on your own scout’s orders.' };

export interface OrderNoteDeps {
  supabase: SupabaseClient;
  now: () => number;
  actor: OrderNoteActor;
}

/**
 * Saves (or, with empty text, clears) an order's note. The admin may note any order; a family only a placed order
 * credited to a scout in their scope, any source and paid or not. Unchanged text writes nothing. Audited.
 */
export async function setOrderNote(orderId: unknown, raw: unknown, deps: OrderNoteDeps): Promise<OrderNoteResult> {
  const { supabase: sb, actor } = deps;
  const id = typeof orderId === 'number' ? orderId : Number.NaN;
  if (!Number.isInteger(id) || id <= 0) return actor.kind === 'family' ? FORBIDDEN : { ok: false, code: 'invalid', error: 'That order no longer exists.' };
  const parsed = parseOrderNote(raw);
  if (!parsed.ok) return { ok: false, code: 'invalid', error: parsed.error };

  const { data: before } = await sb.from('wreath_orders').select('order_number, status, credited_person_id, order_note').eq('id', id).maybeSingle();
  const b = before as { order_number: string; status: string; credited_person_id: number | null; order_note: string | null } | null;
  if (actor.kind === 'family') {
    // Same answer whether the order is missing, someone else's or cancelled: nothing to learn by probing ids.
    if (!b || b.status !== 'placed' || b.credited_person_id == null || !actor.viewer.scope.includes(b.credited_person_id)) return FORBIDDEN;
  } else if (!b) return { ok: false, code: 'invalid', error: 'That order no longer exists.' };
  if ((b.order_note ?? null) === parsed.note) return { ok: true };

  const editor = actor.kind === 'family' ? actor.viewer.personId : actor.personId;
  const patch = {
    order_note: parsed.note,
    order_note_updated_by_person_id: parsed.note ? editor : null,
    order_note_updated_at: parsed.note ? new Date(deps.now()).toISOString() : null
  };
  let q = sb.from('wreath_orders').update(patch).eq('id', id);
  if (actor.kind === 'family') q = q.eq('status', 'placed').in('credited_person_id', actor.viewer.scope);
  const { data: written, error } = await q.select('id').maybeSingle();
  if (error) return { ok: false, code: 'invalid', error: 'Couldn’t save the note. Please try again.' };
  if (!written) return actor.kind === 'family' ? FORBIDDEN : { ok: false, code: 'invalid', error: 'That order no longer exists.' };

  const who: AuditActor = actor.kind === 'family' ? { personId: actor.viewer.personId, label: actor.viewer.name } : { personId: actor.personId, label: actor.label };
  await recordAuditAs(sb, who, {
    area: 'wreaths',
    action: 'update',
    entityType: 'wreath_order',
    entityId: id,
    summary: `Edited the order note on order ${b.order_number}`,
    // A plain diff (no `subjects`): the order's Changes list reads only that shape (admin-data loadOrderHistory).
    details: [{ field: 'Order note', from: b.order_note || '—', to: parsed.note || '—' }]
  });
  return { ok: true };
}
