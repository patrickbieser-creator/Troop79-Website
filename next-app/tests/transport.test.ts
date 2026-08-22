import { describe, it, expect } from 'vitest';
import {
  LEG_LABEL,
  RIDE_STATUS_LABEL,
  RIDE_STATUSES,
  capacityLabel,
  defaultSeats,
  legTiles,
  rideCell,
  summarizePlacements,
  type TransportCar,
  type TransportEntry
} from '../src/lib/transport';

/**
 * Event Logistics Phase 1 — the transportation math (Plans/Event-Logistics.md
 * §A), asserted without a browser. These are the campout sheet's
 * Need / Avail / Short-Over block, defined over entries JOIN memberships:
 *   riders   = attending entries whose ride status is needs_ride (placed or not)
 *   placed   = riders with a membership in this leg's car set
 *   unplaced = riders − placed
 *   room     = Σ (capacity − 1) over cars — passenger seats, the driver excluded
 *   shortOver = room − riders
 */
function entry(over: Partial<TransportEntry> & { id: number }): TransportEntry {
  return {
    status: 'yes',
    participation: 'full',
    drivesOut: false,
    drivesBack: false,
    vehicleSeatsOut: null,
    vehicleSeatsBack: null,
    rideOut: 'needs_ride',
    rideBack: 'needs_ride',
    ...over
  };
}

const driver = entry({
  id: 1,
  drivesOut: true,
  vehicleSeatsOut: 4,
  rideOut: null,
  drivesBack: true,
  vehicleSeatsBack: 4,
  rideBack: null
});
const carOut: TransportCar = { id: 100, leg: 'out', driverEntryId: 1, capacity: 4, memberEntryIds: [1, 2] };
const carBack: TransportCar = { id: 101, leg: 'back', driverEntryId: 1, capacity: 4, memberEntryIds: [1] };

describe('vocabulary', () => {
  it('RideStatuses_AreTheFourPatrickNamed', () => {
    expect([...RIDE_STATUSES]).toEqual(['needs_ride', 'self', 'meeting_there', 'not_traveling']);
    for (const s of RIDE_STATUSES) expect(RIDE_STATUS_LABEL[s]).toBeTruthy();
    expect(LEG_LABEL.out).toBe('There');
    expect(LEG_LABEL.back).toBe('Back');
  });

  it('DefaultSeats_PrefersTheRememberedCapacity', () => {
    expect(defaultSeats(6)).toBe(6);
    expect(defaultSeats(null)).toBe(4);
  });
});

describe('legTiles', () => {
  const entries = [
    driver,
    entry({ id: 2 }), // placed there, unplaced back
    entry({ id: 3 }), // unplaced both
    entry({ id: 4, rideOut: 'self', rideBack: 'meeting_there' }),
    entry({ id: 5, status: 'cancelled' }), // ignored
    entry({ id: 6, status: 'no' }), // ignored
    entry({ id: 7, participation: 'driver_only', drivesOut: true, vehicleSeatsOut: 2, rideOut: null, rideBack: 'not_traveling' })
  ];
  const cars = [carOut, carBack, { id: 102, leg: 'out' as const, driverEntryId: 7, capacity: 2, memberEntryIds: [7] }];

  it('LegTiles_CountRidersPlacedUnplacedRoomShortOver_PerLeg', () => {
    const out = legTiles(entries, cars, 'out');
    expect(out).toEqual({
      riders: 2,
      placed: 1,
      unplaced: 1,
      drivers: 2,
      room: 4, // (4-1) + (2-1)
      shortOver: 2,
      self: 1,
      meetingThere: 0,
      notTraveling: 0
    });
    const back = legTiles(entries, cars, 'back');
    expect(back).toEqual({
      riders: 2,
      placed: 0,
      unplaced: 2,
      drivers: 1,
      room: 3,
      shortOver: 1,
      self: 0,
      meetingThere: 1,
      notTraveling: 1
    });
  });

  it('LegTiles_GoesNegative_WhenMoreRidersThanSeats', () => {
    const many = [driver, ...[2, 3, 4, 5, 6].map((id) => entry({ id }))];
    expect(legTiles(many, [carOut], 'out').shortOver).toBe(-2);
  });

  it('LegTiles_IgnoresPlacementsInAnotherLeg', () => {
    // Entry 2 is in the OUT car only; the back leg must not count it as placed.
    expect(legTiles(entries, cars, 'back').placed).toBe(0);
  });
});

describe('labels', () => {
  it('CapacityLabel_ShowsCountOfCapacity_AndFullWhenFull', () => {
    expect(capacityLabel(2, 4)).toBe('2 of 4 · 2 open');
    expect(capacityLabel(4, 4)).toBe('Full · 4 of 4');
    expect(capacityLabel(3, null)).toBe('3');
  });

  it('RideCell_DescribesTheLeg_ForDriversRidersAndTheRest', () => {
    expect(rideCell(driver, 'out', null)).toBe('Driving · 4 seats');
    expect(rideCell(entry({ id: 2 }), 'out', 'Porter')).toBe('Porter');
    expect(rideCell(entry({ id: 3 }), 'out', null)).toBe('Needs a ride');
    expect(rideCell(entry({ id: 4, rideOut: 'self' }), 'out', null)).toBe('Driving separately');
    expect(rideCell(entry({ id: 8, rideBack: 'not_traveling' }), 'back', null)).toBe('Not traveling');
  });
});

describe('summarizePlacements (family-facing)', () => {
  it('SummarizePlacements_GroupsByPersonAndSet_UsingFamilyNameForCars', () => {
    const lines = summarizePlacements([
      { entryId: 1, personName: 'Maya', setLabel: 'Cars there', kind: 'car', leg: 'out', groupName: 'Jason Porter', driverFamilyName: 'Porter' },
      { entryId: 1, personName: 'Maya', setLabel: 'Cars back', kind: 'car', leg: 'back', groupName: 'Patrick Bieser', driverFamilyName: 'Bieser' },
      { entryId: 1, personName: 'Maya', setLabel: 'Tents', kind: 'tent', leg: null, groupName: 'Tent 3', driverFamilyName: null },
      { entryId: 2, personName: 'Anjali', setLabel: 'Cars there', kind: 'car', leg: 'out', groupName: 'Jason Porter', driverFamilyName: 'Porter' }
    ]);
    expect(lines).toEqual([
      { entryId: 1, personName: 'Maya', parts: ['riding with the Porters (there)', 'riding with the Biesers (back)', 'Tents: Tent 3'] },
      { entryId: 2, personName: 'Anjali', parts: ['riding with the Porters (there)'] }
    ]);
  });

  it('SummarizePlacements_SaysDriving_ForTheDriverOfTheCar', () => {
    const [line] = summarizePlacements([
      { entryId: 1, personName: 'Patrick', setLabel: 'Cars there', kind: 'car', leg: 'out', groupName: 'Patrick Bieser', driverFamilyName: 'Bieser', isDriver: true }
    ]);
    expect(line.parts).toEqual(['driving (there)']);
  });

  it('SummarizePlacements_DoesNotPluralizeANameEndingInS', () => {
    const [line] = summarizePlacements([
      { entryId: 1, personName: 'Maya', setLabel: 'Cars there', kind: 'car', leg: 'out', groupName: 'x', driverFamilyName: 'Hess' }
    ]);
    expect(line.parts).toEqual(['riding with the Hess family (there)']);
  });
});
