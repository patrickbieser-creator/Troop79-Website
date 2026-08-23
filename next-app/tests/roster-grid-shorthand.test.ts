import { describe, it, expect } from 'vitest';
import { PARTICIPANT_CLASS_SHORT, PARTICIPANT_CLASSES } from '../src/lib/participant-class';
import { driverShortName, rideShort, RIDE_STATUS_SHORT, type TransportEntry } from '../src/lib/transport';
import { leaderColumnHeader } from '../src/lib/leader-columns';

/**
 * Roster grid bundle (Plans/Roster-Status-Tab.md, Patrick 2026-08-22): the
 * shorthand the narrow grid cells and headers use. Full labels survive in
 * tooltips, the edit drawer and the CSV — only the grid is abbreviated.
 */
const entry = (over: Partial<TransportEntry> = {}): TransportEntry => ({
  id: 1,
  status: 'yes',
  participation: 'full',
  drivesOut: false,
  drivesBack: false,
  vehicleSeatsOut: null,
  vehicleSeatsBack: null,
  rideOut: 'needs_ride',
  rideBack: 'needs_ride',
  ...over
});

describe('participant class shorthand', () => {
  it('ClassShort_CoversEveryClass_WithTheAgreedCodes', () => {
    for (const c of PARTICIPANT_CLASSES) expect(PARTICIPANT_CLASS_SHORT[c]).toBeTruthy();
    expect(PARTICIPANT_CLASS_SHORT.scout).toBe('S');
    expect(PARTICIPANT_CLASS_SHORT.adult).toBe('A');
    expect(PARTICIPANT_CLASS_SHORT.junior_leader).toBe('JL');
    expect(PARTICIPANT_CLASS_SHORT.cub_scout).toBe('Cub');
    expect(PARTICIPANT_CLASS_SHORT.webelos).toBe('W');
    expect(PARTICIPANT_CLASS_SHORT.youth_guest).toBe('G');
    expect(PARTICIPANT_CLASS_SHORT.adult_guest).toBe('G');
  });
});

describe('driverShortName', () => {
  it('DriverShortName_IsFirstInitialPlusLastName', () => {
    expect(driverShortName('Patrick Bieser')).toBe('PBieser');
    expect(driverShortName('Anjali Sankpal-Tatera')).toBe('ASankpal-Tatera');
    expect(driverShortName('Mary Ann Smith')).toBe('MSmith');
  });
  it('DriverShortName_LeavesASingleWordAlone', () => {
    expect(driverShortName('Driver')).toBe('Driver');
  });
});

describe('rideShort', () => {
  it('RideShort_IsTheDriverShortName_WhenPlacedInACar', () => {
    expect(rideShort(entry(), 'out', 'Patrick Bieser')).toBe('PBieser');
  });
  it('RideShort_IsTheStatusShorthand_WhenNotPlaced', () => {
    expect(rideShort(entry(), 'out', null)).toBe('');
    expect(RIDE_STATUS_SHORT.needs_ride).toBe('');
    expect(rideShort(entry({ rideBack: 'self' }), 'back', null)).toBe('self');
    expect(rideShort(entry({ rideBack: 'meeting_there' }), 'back', null)).toBe('meeting');
    expect(rideShort(entry({ rideBack: 'not_traveling' }), 'back', null)).toBe('—');
  });
  it('RideShort_NamesTheirOwnCar_OnALegTheyDrive', () => {
    const driver = entry({ drivesOut: true, vehicleSeatsOut: 4, rideOut: null });
    expect(rideShort(driver, 'out', null, 'Patrick Bieser')).toBe('PBieser');
    expect(rideShort(driver, 'out', null)).toBe('');
  });
});

describe('leaderColumnHeader', () => {
  it('LeaderHeader_ShortensThePresets', () => {
    expect(leaderColumnHeader('Health form in hand')).toBe('Health form');
    expect(leaderColumnHeader('Registered with council')).toBe('Registered');
  });
  it('LeaderHeader_LeavesCustomPromptsAlone', () => {
    expect(leaderColumnHeader('Tent plan')).toBe('Tent plan');
  });
});
