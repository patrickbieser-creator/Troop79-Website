'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { cancelScoutOrder, editScoutOrder, setScoutSettings, type EntryResult } from '@/lib/wreaths/scout-entry';
import { resolveScoutEntryViewer } from '@/lib/wreaths/scout-entry-viewer';
import { expireOrderCheckout } from '@/lib/wreaths/stripe-client';
import { setOrderNote } from '@/lib/wreaths/order-note-save';
import type { OrderNoteResult } from '@/lib/wreaths/order-note';

/**
 * Members › Wreath sale: edit or cancel a scout-entered order, set a scout's goal. Each action re-derives the viewer
 * from the SESSION (verified identity, revocation epoch, resolveFamilyScope) and never takes a person id as authority;
 * lib/wreaths/scout-entry.ts decides whether that viewer may touch the order or scout. A leader proxying a family
 * (`?viewScout=`) is only a page-level lens: the session is still the leader's, whose scope does not include the
 * family's scout, so every one of these refuses.
 */
const PATH = '/member/wreaths';
const SIGN_IN: EntryResult = { ok: false, code: 'forbidden', error: 'Sign in as the scout, or a parent, to change this.' };

async function ctx() {
  const supabase = createAdminClient();
  return { supabase, now: () => Date.now(), viewer: await resolveScoutEntryViewer(supabase) };
}

export async function saveScoutOrderAction(raw: unknown): Promise<EntryResult> {
  const deps = await ctx();
  if (!deps.viewer) return SIGN_IN;
  const res = await editScoutOrder(raw, deps);
  // After the edit is authorized and saved: an open card session would still charge the old total (Release B).
  const orderId = Number((raw as { orderId?: unknown } | null)?.orderId);
  if (res.ok && Number.isInteger(orderId)) await expireOrderCheckout(orderId);
  if (res.ok) revalidatePath(PATH);
  return res;
}

export async function cancelScoutOrderAction(orderId: number): Promise<EntryResult> {
  const deps = await ctx();
  if (!deps.viewer) return SIGN_IN;
  const res = await cancelScoutOrder(orderId, deps);
  if (res.ok) await expireOrderCheckout(orderId);
  if (res.ok) revalidatePath(PATH);
  return res;
}

export async function setScoutSettingsAction(sellerPersonId: number, v: { goal: string; deliveryMessage: string }): Promise<EntryResult> {
  const deps = await ctx();
  if (!deps.viewer) return SIGN_IN;
  const res = await setScoutSettings(sellerPersonId, { goal: v.goal, deliveryMessage: v.deliveryMessage }, deps);
  if (res.ok) revalidatePath(PATH);
  return res;
}

/** The troop-only order note (W-1) on an order credited to the family's scout: any source, paid or not, while placed. */
export async function setOrderNoteAction(orderId: number, note: string): Promise<OrderNoteResult> {
  const deps = await ctx();
  if (!deps.viewer) return { ok: false, code: 'forbidden', error: 'Sign in as the scout, or a parent, to change this.' };
  const res = await setOrderNote(orderId, note, { supabase: deps.supabase, now: deps.now, actor: { kind: 'family', viewer: deps.viewer } });
  if (res.ok) revalidatePath(PATH);
  return res;
}
