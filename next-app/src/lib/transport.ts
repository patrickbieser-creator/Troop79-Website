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
}

export interface TransportCar {
  id: number;
  leg: Leg;
  driverEntryId: number;
  capacity: number;
  /** Every member, driver included. */
  memberEntryIds: number[];
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
