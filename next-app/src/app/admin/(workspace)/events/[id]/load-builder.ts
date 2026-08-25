/**
 * Loads what the signup builder needs for one signup. Shared by the builder's
 * own page (/admin/events/[id]) and the calendar entry workbench, which
 * renders the builder inside its Signup tab when a signup exists (Patrick,
 * 2026-08-24: "if sign-up was previously enabled, display that editor as well
 * when clicking on the tab"). Callers enforce the capability themselves.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { loadEventNav } from '../../rosters/[id]/event-nav-data';
import { loadEmailTemplates } from '../../advancement/lookups/email-template-actions';
import { previewContext } from '@/lib/signup-confirmation-preview';
import { siteUrl } from '@/lib/site-url';

export async function loadBuilderData(signupId: number) {
  const supabase = createAdminClient();
  const { data: signup } = await supabase
    .from('event_signups')
    .select('*')
    .eq('id', signupId)
    .maybeSingle();
  if (!signup) return null;
  const s = signup as unknown as { calendar_entry_id: number; id: number };

  const [{ data: entry }, { data: prices }, { data: slots }, { data: questions }] = await Promise.all([
    supabase
      .from('calendar_entries')
      .select('id, title, entry_date, end_date, category, start_time, end_time, location')
      .eq('id', s.calendar_entry_id)
      .maybeSingle(),
    supabase
      .from('event_prices')
      .select('*')
      .eq('event_signup_id', s.id)
      .order('sort')
      .order('id'),
    supabase
      .from('signup_slots')
      .select('*')
      .eq('event_signup_id', s.id)
      // Must match the public ordering in lib/event-signup.ts — the builder
      // list is what a leader checks the family-facing order against.
      .order('slot_date')
      .order('sort')
      .order('starts_at', { nullsFirst: false })
      .order('id'),
    supabase.from('signup_questions').select('*').eq('event_signup_id', s.id).order('sort').order('id')
  ]);

  // Assignments block (Plans/Event-Logistics.md §B): the sets on this signup
  // with how many groups and placements each holds, so Remove can warn.
  const { data: setRows } = await supabase
    .from('signup_group_sets')
    .select('id, kind, label, leg, seed_from_roster, self_select, family_visible, default_capacity, sort')
    .eq('event_signup_id', s.id)
    .order('sort')
    .order('id');
  const setIds = ((setRows ?? []) as { id: number }[]).map((r) => r.id);
  const [{ data: groupRows }, { data: memberRows }] = setIds.length
    ? await Promise.all([
        supabase.from('signup_groups').select('set_id').in('set_id', setIds),
        supabase.from('signup_group_members').select('set_id').in('set_id', setIds)
      ])
    : [{ data: [] as unknown[] }, { data: [] as unknown[] }];
  const groupCount = new Map<number, number>();
  for (const g of (groupRows ?? []) as { set_id: number }[]) groupCount.set(g.set_id, (groupCount.get(g.set_id) ?? 0) + 1);
  const memberCount = new Map<number, number>();
  for (const m of (memberRows ?? []) as { set_id: number }[]) memberCount.set(m.set_id, (memberCount.get(m.set_id) ?? 0) + 1);
  const sets = ((setRows ?? []) as Record<string, unknown>[]).map((r) => ({
    ...r,
    group_count: groupCount.get(Number(r.id)) ?? 0,
    member_count: memberCount.get(Number(r.id)) ?? 0
  }));

  const [nav, templates] = await Promise.all([loadEventNav(supabase, s.id, s.calendar_entry_id), loadEmailTemplates()]);
  // The Confirmation email block previews with this event's real logistics.
  const e = (entry ?? null) as { title?: string; entry_date?: string; end_date?: string | null; start_time?: string | null; end_time?: string | null; location?: string | null } | null;
  const sig = signup as { deadline?: string | null; payment_instructions?: string | null };
  const previewCtx = e
    ? previewContext({
        entryId: s.calendar_entry_id,
        title: e.title ?? '',
        entryDate: e.entry_date ?? '',
        endDate: e.end_date,
        startTime: e.start_time,
        endTime: e.end_time,
        location: e.location,
        deadline: sig.deadline,
        paymentInstructions: sig.payment_instructions,
        siteUrl: siteUrl()
      })
    : null;
  return {
    templates,
    previewCtx,
    nav,
    signup: signup as Record<string, unknown>,
    entry: entry as Record<string, unknown> | null,
    prices: (prices ?? []) as Record<string, unknown>[],
    slots: (slots ?? []) as Record<string, unknown>[],
    questions: (questions ?? []) as Record<string, unknown>[],
    sets
  };
}

export type BuilderData = NonNullable<Awaited<ReturnType<typeof loadBuilderData>>>;
