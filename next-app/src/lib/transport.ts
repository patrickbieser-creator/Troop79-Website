/**
 * Transportation — the campout sheet's driver/seat block as pure functions
 * (Plans/Event-Logistics.md §A, Patrick 2026-08-22).
 *
 * Conventions that every caller must share:
 *   - `vehicleSeats*` counts INCLUDING the driver (the sheet's "Patrick 4/4").
 *   - A car is a `signup_groups` row in a kind='car' set with a `leg`; the
 *     driver is a member of their own car, so "3 of 4" counts them.
 *   - `ride*` is NULL for a leg the person drives; otherwise one of the four
 *     statuses. Placing someone in a car does NOT change it — the membership
 *     is what satisfies a needs_ride.
 *
 * Everything here is pure so the board and the roster tiles are asserted
 * without a browser; the Server Actions only apply what these compute.
 */

import { fmtWhen } from '@/lib/format-date';

export type Leg = 'out' | 'back';
export const LEGS: readonly Leg[] = ['out', 'back'];
export const LEG_LABEL: Record<Leg, string> = { out: 'There', back: 'Back' };

export const RIDE_STATUSES = ['needs_ride', 'self', 'meeting_there', 'not_traveling'] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];
export const RIDE_STATUS_LABEL: Record<RideStatus, string> = {
  needs_ride: 'Needs a ride',
  self: 'Driving separately',
  meeting_there: 'Meeting there',
  not_traveling: 'Not traveling'
};
export function isRideStatus(v: unknown): v is RideStatus {
  return typeof v === 'string' && (RIDE_STATUSES as readonly string[]).includes(v);
}

/** A family's seat input prefills from the driver's remembered capacity; 4 is
 *  the ordinary car when nothing is known. */
export function defaultSeats(remembered: number | null | undefined): number {
  return remembered && remembered >= 1 ? remembered : 4;
}

export interface TransportEntry {
  id: number;
  status: string; // 'yes' | 'no' | 'waitlist' | 'cancelled'
  participation: string; // 'full' | 'driver_only' | 'contributor'
  drivesOut: boolean;
  drivesBack: boolean;
  vehicleSeatsOut: number | null;
  vehicleSeatsBack: number | null;
  rideOut: RideStatus | null;
  rideBack: RideStatus | null;
  /** When this person arrives (There) / leaves (Back) if not with the group — an
   *  ISO instant. Absent or null = with the group (the event's own times). */
  outDepartsAt?: string | null;
  backDepartsAt?: string | null;
}

export interface TransportCar {
  id: number;
  leg: Leg;
  driverEntryId: number;
  capacity: number;
  /** Every member, driver included. */
  memberEntryIds: number[];
  /** The car's wave — its driver's leg time. Absent or null = with the group. */
  departsAt?: string | null;
}

export interface LegTiles {
  /** Attending people who need a seat, placed or not. */
  riders: number;
  placed: number;
  unplaced: number;
  drivers: number;
  /** Passenger seats: Σ (capacity − 1). */
  room: number;
  /** room − riders; negative means not enough seats. */
  shortOver: number;
  self: number;
  meetingThere: number;
  notTraveling: number;
}

function drives(e: TransportEntry, leg: Leg): boolean {
  return leg === 'out' ? e.drivesOut : e.drivesBack;
}
function ride(e: TransportEntry, leg: Leg): RideStatus | null {
  return leg === 'out' ? e.rideOut : e.rideBack;
}

/** The sheet's Need / Avail / Short-Over block for one leg. Only `status='yes'`
 *  entries travel; declines, waitlist and cancellations are not counted. */
export function legTiles(entries: readonly TransportEntry[], cars: readonly TransportCar[], leg: Leg): LegTiles {
  const live = entries.filter((e) => e.status === 'yes');
  const legCars = cars.filter((c) => c.leg === leg);
  const placedIds = new Set(legCars.flatMap((c) => c.memberEntryIds));
  const riders = live.filter((e) => !drives(e, leg) && ride(e, leg) === 'needs_ride');
  const placed = riders.filter((e) => placedIds.has(e.id)).length;
  const room = legCars.reduce((n, c) => n + Math.max(0, c.capacity - 1), 0);
  return {
    riders: riders.length,
    placed,
    unplaced: riders.length - placed,
    drivers: live.filter((e) => drives(e, leg)).length,
    room,
    shortOver: room - riders.length,
    self: live.filter((e) => ride(e, leg) === 'self').length,
    meetingThere: live.filter((e) => ride(e, leg) === 'meeting_there').length,
    notTraveling: live.filter((e) => ride(e, leg) === 'not_traveling').length
  };
}

/** "2 of 4 · 2 open" / "Full · 4 of 4" / "3" (no limit). Members include the
 *  driver for cars, matching the sheet's including-the-driver count. */
export function capacityLabel(members: number, capacity: number | null): string {
  if (capacity == null) return String(members);
  if (members >= capacity) return `Full · ${members} of ${capacity}`;
  return `${members} of ${capacity} · ${capacity - members} open`;
}

/** One roster/CSV cell for one leg: who they ride with, or why they don't. */
export function rideCell(e: TransportEntry, leg: Leg, carDriverName: string | null): string {
  if (drives(e, leg)) {
    const seats = leg === 'out' ? e.vehicleSeatsOut : e.vehicleSeatsBack;
    return seats ? `Driving · ${seats} seats` : 'Driving';
  }
  const r = ride(e, leg);
  if (r === 'needs_ride') return carDriverName ?? RIDE_STATUS_LABEL.needs_ride;
  if (r) return RIDE_STATUS_LABEL[r];
  return '—';
}

/** Grid shorthand for a ride status (Patrick, 2026-08-22 — "shorthand is
 *  fine"); the full RIDE_STATUS_LABEL stays in the tooltip, drawer and CSV. */
export const RIDE_STATUS_SHORT: Record<RideStatus, string> = {
  needs_ride: '',        // blank = still needs a ride (Patrick: "just leave it blank"); hover says so
  self: 'self',
  meeting_there: 'meeting',
  not_traveling: '—'
};

/** "Patrick Bieser" → "PBieser" (Patrick, 2026-08-22: "all one word" — no
 *  period, no space); a one-word name is returned whole. */
export function driverShortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name.trim();
  return `${parts[0][0].toUpperCase()}${parts[parts.length - 1]}`;
}

/** The narrow Ride To / Ride From grid cell: the driver as "PBieser" when
 *  placed in a car, else the status shorthand. On a leg they DRIVE the cell
 *  names their own car (`selfName` → "PBieser") — a driver is assigned to
 *  their own car by default (Patrick, 2026-08-22); '' when no name is given. */
export function rideShort(e: TransportEntry, leg: Leg, carDriverName: string | null, selfName?: string | null): string {
  if (drives(e, leg)) return selfName ? driverShortName(selfName) : '';
  const r = ride(e, leg);
  if (r === 'needs_ride') return carDriverName ? driverShortName(carDriverName) : RIDE_STATUS_SHORT.needs_ride;
  if (r) return RIDE_STATUS_SHORT[r];
  return '—';
}

/** A placement row as the family-facing loader shapes it. */
export interface PlacementRow {
  entryId: number;
  personName: string;
  setLabel: string;
  kind: string;
  leg: Leg | null;
  groupName: string;
  /** For cars: the driver's family name — the only identity a family sees. */
  driverFamilyName: string | null;
  /** For cars: this entry IS the driver of that car. */
  isDriver?: boolean;
}

export interface PlacementLine {
  entryId: number;
  personName: string;
  parts: string[];
}

/** "Maya — riding with the Porters (there), riding with the Biesers (back),
 *  Tents: Tent 3". Family name only for cars — never a driver's phone, email
 *  or the full manifest (qa-lead; Patrick accepted Tier 1 for this). */
export function summarizePlacements(rows: readonly PlacementRow[]): PlacementLine[] {
  const byEntry = new Map<number, PlacementLine>();
  for (const r of rows) {
    const line = byEntry.get(r.entryId) ?? { entryId: r.entryId, personName: r.personName, parts: [] };
    if (r.kind === 'car' && r.isDriver) {
      line.parts.push(`driving${r.leg ? ` (${LEG_LABEL[r.leg].toLowerCase()})` : ''}`);
    } else if (r.kind === 'car') {
      const fam = r.driverFamilyName ?? r.groupName;
      const who = /s$/i.test(fam) ? `the ${fam} family` : `the ${fam}s`;
      line.parts.push(`riding with ${who}${r.leg ? ` (${LEG_LABEL[r.leg].toLowerCase()})` : ''}`);
    } else {
      line.parts.push(`${r.setLabel}: ${r.groupName}`);
    }
    byEntry.set(r.entryId, line);
  }
  return [...byEntry.values()];
}

/* ── When: a leg's departure time and the waves cars fall into ─────────────
 * Plans/Event-Signup-Arrival-Times.md. A leg carries an optional instant —
 * NULL is "with the group" (the event's own times). Cars inherit their
 * driver's time. A "wave" is every car and rider sharing one departure, so the
 * board, the sheet and the roster all read the same grouping and one rule.
 */

export const WITH_THE_GROUP = 'With the group';

/** The leg's own departure instant, null = with the group. */
export function legDepartsAt(e: TransportEntry, leg: Leg): string | null {
  return (leg === 'out' ? e.outDepartsAt : e.backDepartsAt) ?? null;
}

/** Identity of a departure: null → '', otherwise epoch ms — so '…14:00:00Z' and
 *  '…14:00:00+00:00' are the same wave. */
function waveKey(departsAt: string | null | undefined): string {
  if (!departsAt) return '';
  const ms = Date.parse(departsAt);
  return Number.isNaN(ms) ? '' : String(ms);
}

/** "With the group" / "Sat 9:00 am" ("Saturday 9:00 am" with `{long:true}`). */
export function waveLabel(departsAt: string | null | undefined, o: { long?: boolean } = {}): string {
  return waveKey(departsAt) === '' ? WITH_THE_GROUP : fmtWhen(departsAt, o);
}

export interface Wave {
  key: string;
  departsAt: string | null;
  label: string;
  carIds: number[];
  /** Attending non-drivers who need a seat on this leg at this time, placed or not. */
  riderIds: number[];
}

/** Cars and needs-a-ride riders for one leg, grouped by departure — "with the
 *  group" first, then later times in order. A wave with neither is not listed. */
export function wavesFor(leg: Leg, entries: readonly TransportEntry[], cars: readonly TransportCar[]): Wave[] {
  const waves = new Map<string, Wave>();
  const wave = (departsAt: string | null | undefined): Wave => {
    const key = waveKey(departsAt);
    let w = waves.get(key);
    if (!w) {
      w = { key, departsAt: key === '' ? null : new Date(Number(key)).toISOString(), label: waveLabel(departsAt), carIds: [], riderIds: [] };
      waves.set(key, w);
    }
    return w;
  };
  for (const c of cars) if (c.leg === leg) wave(c.departsAt).carIds.push(c.id);
  for (const e of entries) {
    if (e.status !== 'yes' || e.participation === 'contributor') continue;
    if (drives(e, leg) || ride(e, leg) !== 'needs_ride') continue;
    wave(legDepartsAt(e, leg)).riderIds.push(e.id);
  }
  return [...waves.values()].sort((a, b) => (a.key === '' ? -1 : b.key === '' ? 1 : Number(a.key) - Number(b.key)));
}

export type PlacementCheck =
  | { ok: true; crossesWaves: boolean }
  | { ok: false; riderWave: string; carWave: string; message: string };

/** May this rider go in this car? Only when their departures match, unless a
 *  leader overrides (`override: true`) — then it is allowed and says it crosses. */
export function placementCheck(
  leg: Leg,
  rider: TransportEntry,
  car: TransportCar,
  o: { override?: boolean } = {}
): PlacementCheck {
  const riderAt = legDepartsAt(rider, leg);
  if (waveKey(riderAt) === waveKey(car.departsAt)) return { ok: true, crossesWaves: false };
  if (o.override) return { ok: true, crossesWaves: true };
  const riderWave = waveLabel(riderAt);
  const carWave = waveLabel(car.departsAt);
  return {
    ok: false,
    riderWave,
    carWave,
    message: `This car leaves ${carWave === WITH_THE_GROUP ? 'with the group' : carWave}; they ride ${riderWave === WITH_THE_GROUP ? 'with the group' : riderWave}.`
  };
}

/** A driver's family name for "with Bieser" — the last word. */
export function familyName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? name;
}

/** The sheet / roster line for a leg that has a time: "Arrives Sat 9:00 am (own
 *  car)", "Leaves Sat 4:00 pm with Bieser". Null when the leg is with the group
 *  or not travelled — the event's own times are not repeated per person. */
export function legTimeLine(e: TransportEntry, leg: Leg, carDriverName: string | null): string | null {
  const at = legDepartsAt(e, leg);
  if (!at) return null;
  const r = ride(e, leg);
  if (!drives(e, leg) && r === 'not_traveling') return null;
  const head = `${leg === 'out' ? 'Arrives' : 'Leaves'} ${fmtWhen(at)}`;
  if (drives(e, leg)) return `${head} (driving)`;
  if (r === 'self') return `${head} (own car)`;
  if (r === 'meeting_there') return `${head} (meeting there)`;
  return carDriverName ? `${head} with ${familyName(carDriverName)}` : `${head} (needs a ride)`;
}

export type CarRiderGuard = { ok: true } | { ok: false; error: string };

/**
 * placeInGroup's pre-RPC check for a car: the rider must be an entry on THIS
 * signup (`null` = not found under it — refuse, never skip; qa-lead on
 * v1.191.0), and their leg time must match the car's wave unless a leader
 * overrides on the board.
 */
export function carRiderGuard(
  leg: Leg,
  rider: { out: string | null; back: string | null } | null,
  carDepartsAt: string | null
): CarRiderGuard {
  if (!rider) return { ok: false, error: 'That person is not on this signup — the page will refresh.' };
  const entry: TransportEntry = {
    id: 0, status: 'yes', participation: 'full', drivesOut: false, drivesBack: false,
    vehicleSeatsOut: null, vehicleSeatsBack: null, rideOut: 'needs_ride', rideBack: 'needs_ride',
    outDepartsAt: rider.out, backDepartsAt: rider.back
  };
  const car: TransportCar = { id: 0, leg, driverEntryId: 0, capacity: 1, memberEntryIds: [], departsAt: carDepartsAt };
  const check = placementCheck(leg, entry, car);
  return check.ok ? { ok: true } : { ok: false, error: `${check.message} A leader can confirm it on the board.` };
}
