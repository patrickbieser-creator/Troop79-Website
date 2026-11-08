import { describe, it, expect } from 'vitest';
import { stationPlanOf } from '../src/lib/family-week';
import type { ThisWeek } from '../src/lib/this-week';

/** Station rotations step 5: what a family sees for a scout in a rotation group. Pure. */
const teacher = (personId: number, formal: string) => ({ personId, name: formal, formal });
const tw = {
  rotation: {
    on: true,
    problem: null,
    badgeId: 'climbing',
    badgeName: 'Climbing',
    stations: [
      { key: 'fg:1', title: 'Safety', goalMinutes: 20, cells: [], teachers: [teacher(5, 'Mr. R')] },
      { key: 'fg:2', title: 'Terms', goalMinutes: 20, cells: [], teachers: [] },
      { key: 'fg:3', title: 'Ropes', goalMinutes: 20, cells: [], teachers: [] }
    ],
    groups: [
      { number: 1, name: 'Group 1', seededFrom: 'Scout', members: [{ personId: 10 }] },
      { number: 2, name: 'Group 2', seededFrom: 'Tenderfoot', members: [{ personId: 20 }] }
    ],
    rounds: [
      [0, 1],
      [1, 2],
      [2, 0]
    ],
    roundMinutes: 20,
    totalMinutes: 60
  },
  doubles: [{ personId: 20, name: 'Ezra L', primary: 'Group 2', also: ['Scoutmaster conference'], keys: ['star-5'] }]
} as unknown as Pick<ThisWeek, 'rotation' | 'doubles'>;

describe('stationPlanOf', () => {
  it('GroupTwo_StartsAtTheSecondStation', () => {
    expect(stationPlanOf(tw, 20)!.route.map((r) => r.title)).toEqual(['Terms', 'Ropes', 'Safety']);
  });

  it('Route_CarriesEachStationsTeacher', () => {
    expect(stationPlanOf(tw, 10)!.route[0].teachers).toEqual(['Mr. R']);
  });

  it('Group_ReadsGroupNumberStations', () => {
    expect(stationPlanOf(tw, 10)!.group).toEqual({ key: 'rot:1', name: 'Climbing', title: 'Group 1 · Stations', teachers: [] });
  });

  it('Also_ComesFromTheDoubles', () => {
    expect(stationPlanOf(tw, 20)!.alsoIn).toEqual(['Scoutmaster conference']);
  });

  it('NotRotating_IsNull', () => {
    expect(stationPlanOf(tw, 99)).toBeNull();
  });

  it('StationsOff_IsNull', () => {
    expect(stationPlanOf({ ...tw, rotation: { ...tw.rotation!, on: false } }, 10)).toBeNull();
  });
});
