import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { isParticipantClass, type ParticipantClass } from '@/lib/participant-class';
import { isRideStatus, type Leg } from '@/lib/transport';
import { PageTitle } from '../../../_components/page-title';
import { EventNav } from '../event-nav';
import { loadEventNav } from '../event-nav-data';
import styles from '../../../events/events-admin.module.css';
import { AssignmentsBoard, type BoardPerson, type BoardSet } from './assignments-board';

export const metadata = { title: 'Rides & Assignments — Troop 79' };

/*
 * Rides & assignments for one event (Plans/Event-Logistics.md §A/§B): every
 * group set on the signup — cars per leg, patrols, tents, teams — on one
 * drag-and-drop board. Leader-only: it shows names, classes and drivers'
 * phones. Same gate as the roster.
 */
async function load(signupId: number) {
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { data: signup } = await supabase
    .from('event_signups')
    .select('id, calendar_entry_id')
    .eq('id', signupId)
    .maybeSingle();
  if (!signup) return null;
  const sig = signup as { id: number; calendar_entry_id: number };

  const [{ data: entry }, { data: sets }, { data: entries }, { data: people }] = await Promise.all([
    supabase.from('calendar_entries').select('id, title').eq('id', sig.calendar_entry_id).maybeSingle(),
    supabase
      .from('signup_group_sets')
      .select('id, label, kind, leg, self_select, family_visible, sort')
      .eq('event_signup_id', sig.id)
      .order('sort')
      .order('id'),
    supabase
      .from('signup_entries')
      .select(
        'id, person_id, participant_class, status, participation, drives_out, drives_back, vehicle_seats_out, vehicle_seats_back, ride_out, ride_back'
      )
      .eq('event_signup_id', sig.id)
      .neq('status', 'cancelled'),
    supabase.from('people').select('id, display_name, primary_phone')
  ]);

  const setRows = (sets ?? []) as {
    id: number;
    label: string;
    kind: string;
    leg: Leg | null;
    self_select: boolean;
    family_visible: boolean;
  }[];
  const setIds = setRows.map((s) => s.id);
  const { data: groups } = setIds.length
    ? await supabase
        .from('signup_groups')
        .select('id, set_id, name, capacity, driver_entry_id, notes, sort')
        .in('set_id', setIds)
        .order('sort')
        .order('name')
    : { data: [] as unknown[] };
  const { data: members } = setIds.length
    ? await supabase.from('signup_group_members').select('group_id, entry_id').in('set_id', setIds)
    : { data: [] as unknown[] };
  const membersByGroup = new Map<number, number[]>();
  for (const m of (members ?? []) as { group_id: number; entry_id: number }[]) {
    membersByGroup.set(m.group_id, [...(membersByGroup.get(m.group_id) ?? []), m.entry_id]);
  }
  const boardSets: BoardSet[] = setRows.map((s) => ({
    id: s.id,
    label: s.label,
    kind: s.kind,
    leg: s.leg,
    selfSelect: s.self_select,
    familyVisible: s.family_visible,
    groups: ((groups ?? []) as {
      id: number;
      set_id: number;
      name: string;
      capacity: number | null;
      driver_entry_id: number | null;
      notes: string | null;
    }[])
      .filter((g) => g.set_id === s.id)
      .map((g) => ({
        id: g.id,
        name: g.name,
        capacity: g.capacity,
        driverEntryId: g.driver_entry_id,
        notes: g.notes,
        memberEntryIds: membersByGroup.get(g.id) ?? []
      }))
  }));

  const personById = new Map(
    ((people ?? []) as { id: number; display_name: string; primary_phone: string | null }[]).map((p) => [p.id, p])
  );
  const boardPeople: BoardPerson[] = ((entries ?? []) as Record<string, unknown>[]).map((e) => {
    const person = e.person_id ? personById.get(Number(e.person_id)) : null;
    return {
      entryId: Number(e.id),
      name: person?.display_name ?? 'Unknown',
      participantClass: (isParticipantClass(String(e.participant_class))
        ? String(e.participant_class)
        : 'adult') as ParticipantClass,
      status: String(e.status),
      participation: String(e.participation),
      drivesOut: e.drives_out === true,
      drivesBack: e.drives_back === true,
      vehicleSeatsOut: e.vehicle_seats_out ? Number(e.vehicle_seats_out) : null,
      vehicleSeatsBack: e.vehicle_seats_back ? Number(e.vehicle_seats_back) : null,
      rideOut: isRideStatus(e.ride_out) ? e.ride_out : null,
      rideBack: isRideStatus(e.ride_back) ? e.ride_back : null,
      phone: person?.primary_phone ?? null
    };
  });

  const nav = await loadEventNav(supabase, sig.id, sig.calendar_entry_id);
  return { sig, entry: entry as { id: number; title: string } | null, sets: boardSets, people: boardPeople, nav };
}

export default async function AssignmentsPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ set?: string }>;
}) {
  const { id } = await params;
  const signupId = Number(id);
  if (!Number.isInteger(signupId) || signupId < 1) notFound();
  const data = await load(signupId);
  if (!data || !data.entry) notFound();
  // Which set the board opens on — the top-level tab that was clicked
  // (EventNav: one tab per set); falls back to the first set.
  const wanted = Number((await searchParams).set);
  const activeSetId = data.sets.some((s) => s.id === wanted) ? wanted : (data.sets[0]?.id ?? null);

  return (
    <>
      <PageTitle
        title={`${data.entry.title} — Rides & assignments`}
        sub={
          <>
            <Link href="/admin/events" className={styles.actionLinkMuted}>
              All signups
            </Link>{' '}
            ·{' '}
            <Link href={`/events/${data.entry.id}`} className={styles.actionLinkMuted}>
              Public page
            </Link>
          </>
        }
      />
      <EventNav signupId={signupId} active={activeSetId != null ? `set:${activeSetId}` : 'assignments'} sets={data.nav.sets} hasMoney={data.nav.hasMoney} />
      <AssignmentsBoard
        signupId={signupId}
        calendarEntryId={data.entry.id}
        sets={data.sets}
        people={data.people}
        activeSetId={activeSetId}
      />
    </>
  );
}
