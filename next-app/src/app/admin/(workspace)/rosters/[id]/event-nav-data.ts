/**
 * What the event tab row needs to know, loaded once per page (Patrick,
 * 2026-08-22, looking at the Unity Church service project: "it is showing the
 * tabs for Rides and Assignments and Money, neither of which are relevant").
 * Tabs follow the feature: one tab per assignment set that exists (none →
 * no set tabs at all), Money only when the event has prices or any money
 * activity (payments, expenses, reimbursement requests, milestones).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventNavSet } from './event-nav';

export interface EventNavData {
  sets: EventNavSet[];
  hasMoney: boolean;
}

export async function loadEventNav(supabase: SupabaseClient, signupId: number, calendarEntryId: number): Promise<EventNavData> {
  const [{ data: sets }, prices, tx, reqs, ms] = await Promise.all([
    supabase.from('signup_group_sets').select('id, label').eq('event_signup_id', signupId).order('sort').order('id'),
    supabase.from('event_prices').select('id', { count: 'exact', head: true }).eq('event_signup_id', signupId),
    supabase.from('financial_transactions').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', calendarEntryId),
    supabase.from('reimbursement_requests').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', calendarEntryId),
    supabase.from('event_milestones').select('id', { count: 'exact', head: true }).eq('event_signup_id', signupId)
  ]);
  const n = (r: { count: number | null }) => r.count ?? 0;
  return {
    sets: ((sets ?? []) as { id: number; label: string }[]).map((s) => ({ id: s.id, label: s.label })),
    hasMoney: n(prices) + n(tx) + n(reqs) + n(ms) > 0
  };
}
