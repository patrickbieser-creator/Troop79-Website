import { describe, it, expect } from 'vitest';
import {
  LEG_LABEL,
  RIDE_STATUS_LABEL,
  RIDE_STATUSES,
  capacityLabel,
  defaultSeats,
  legTiles,
  legDepartsAt,
  legTimeLine,
  placementCheck,
  waveLabel,
  wavesFor,
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

/**
 * Plans/Event-Signup-Arrival-Times.md: a leg also says WHEN. NULL is "with the
 * group" (the event's own times); a time makes a wave, and a car inherits its
 * driver's time.
 */
const FRI = '2026-10-23T22:30:00+00:00'; // Fri 5:30 pm Central
const SAT = '2026-10-24T14:00:00+00:00'; // Sat 9:00 am Central
const SAT_PM = '2026-10-24T21:00:00Z'; // Sat 4:00 pm Central

describe('leg departure time', () => {
  it('Leg_CarriesADepartureTime_DefaultingToTheEvents', () => {
    const onTime = entry({ id: 1 });
    const late = entry({ id: 2, outDepartsAt: SAT, backDepartsAt: SAT_PM });
    expect(legDepartsAt(onTime, 'out')).toBeNull();
    expect(legDepartsAt(onTime, 'back')).toBeNull();
    expect(legDepartsAt(late, 'out')).toBe(SAT);
    expect(legDepartsAt(late, 'back')).toBe(SAT_PM);
    expect(waveLabel(null)).toBe('With the group');
    expect(waveLabel(SAT)).toBe('Sat 9:00 am');
    expect(waveLabel(SAT, { long: true })).toBe('Saturday 9:00 am');
  });

  it('LegTiles_AreUnchangedByATime', () => {
    const entries = [driver, entry({ id: 2, outDepartsAt: SAT })];
    expect(legTiles(entries, [carOut], 'out').riders).toBe(1);
  });
});

describe('wavesFor', () => {
  const satDriver = entry({ id: 10, drivesOut: true, vehicleSeatsOut: 3, rideOut: null, outDepartsAt: SAT });
  const friCar: TransportCar = { id: 200, leg: 'out', driverEntryId: 1, capacity: 4, memberEntryIds: [1, 2], departsAt: null };
  const satCar: TransportCar = { id: 201, leg: 'out', driverEntryId: 10, capacity: 3, memberEntryIds: [10], departsAt: SAT };
  const entries = [driver, entry({ id: 2 }), entry({ id: 3, outDepartsAt: SAT }), satDriver, entry({ id: 4, rideOut: 'self' })];

  it('Waves_GroupCarsAndRidersByDeparture_WithTheGroupFirst', () => {
    const waves = wavesFor('out', entries, [satCar, friCar]);
    expect(waves.map((w) => w.label)).toEqual(['With the group', 'Sat 9:00 am']);
    expect(waves[0]).toMatchObject({ departsAt: null, carIds: [200], riderIds: [2] });
    expect(waves[1]).toMatchObject({ carIds: [201], riderIds: [3] });
  });

  it('Waves_TreatTheSameInstantInDifferentSpellingsAsOne', () => {
    const waves = wavesFor('out', [entry({ id: 3, outDepartsAt: '2026-10-24T14:00:00Z' })], [satCar]);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toMatchObject({ carIds: [201], riderIds: [3] });
  });

  it('Waves_OrderLaterDeparturesChronologically', () => {
    const noon = { ...satCar, id: 202, departsAt: SAT_PM };
    const waves = wavesFor('out', [], [noon, { ...friCar, departsAt: FRI }, satCar]);
    expect(waves.map((w) => w.label)).toEqual(['Fri 5:30 pm', 'Sat 9:00 am', 'Sat 4:00 pm']);
  });

  it('Waves_OnlyCountTheLegAsked', () => {
    expect(wavesFor('back', entries, [satCar, friCar]).flatMap((w) => w.carIds)).toEqual([]);
  });
});

describe('placementCheck', () => {
  const satRider = entry({ id: 3, outDepartsAt: SAT });
  const friCar: TransportCar = { id: 200, leg: 'out', driverEntryId: 1, capacity: 4, memberEntryIds: [1], departsAt: null };
  const satCar: TransportCar = { id: 201, leg: 'out', driverEntryId: 10, capacity: 3, memberEntryIds: [10], departsAt: SAT };

  it('Placement_AllowsACarInTheRidersOwnWave', () => {
    expect(placementCheck('out', satRider, satCar)).toEqual({ ok: true, crossesWaves: false });
    expect(placementCheck('out', entry({ id: 2 }), friCar)).toEqual({ ok: true, crossesWaves: false });
  });

  it('Placement_RefusesACarInAnotherWave_UnlessALeaderOverrides', () => {
    const refused = placementCheck('out', satRider, friCar);
    expect(refused).toMatchObject({ ok: false, riderWave: 'Sat 9:00 am', carWave: 'With the group' });
    expect(placementCheck('out', satRider, friCar, { override: true })).toEqual({ ok: true, crossesWaves: true });
  });
});

describe('legTimeLine (sheet and roster wording)', () => {
  it('Line_SaysNothing_ForALegWithTheGroup', () => {
    expect(legTimeLine(entry({ id: 1 }), 'out', null)).toBeNull();
  });

  it('Line_SaysArrivesAndLeaves_WithWhom', () => {
    expect(legTimeLine(entry({ id: 1, outDepartsAt: SAT, rideOut: 'self' }), 'out', null)).toBe('Arrives Sat 9:00 am (own car)');
    expect(legTimeLine(entry({ id: 1, backDepartsAt: SAT_PM }), 'back', 'Patrick Bieser')).toBe('Leaves Sat 4:00 pm with Bieser');
    expect(legTimeLine(entry({ id: 1, backDepartsAt: SAT_PM }), 'back', null)).toBe('Leaves Sat 4:00 pm (needs a ride)');
    expect(legTimeLine(entry({ id: 1, outDepartsAt: SAT, rideOut: 'meeting_there' }), 'out', null)).toBe('Arrives Sat 9:00 am (meeting there)');
    expect(legTimeLine(entry({ id: 1, backDepartsAt: SAT_PM, drivesBack: true, vehicleSeatsBack: 4, rideBack: null }), 'back', null)).toBe('Leaves Sat 4:00 pm (driving)');
  });

  it('Line_SaysNothing_ForALegNotTravelled', () => {
    expect(legTimeLine(entry({ id: 1, outDepartsAt: SAT, rideOut: 'not_traveling' }), 'out', null)).toBeNull();
  });
});
