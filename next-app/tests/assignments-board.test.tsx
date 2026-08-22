import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssignmentsBoard, type BoardPerson, type BoardSet } from '../src/app/admin/(workspace)/rosters/[id]/assignments/assignments-board';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));

const placeInGroup = vi.fn(async () => ({ ok: true, outcome: 'placed' as const }));
const unplaceFromGroup = vi.fn(async () => ({ ok: true }));
const setRideStatus = vi.fn(async () => ({ ok: true }));
vi.mock('../src/app/admin/(workspace)/events/actions', () => ({
  placeInGroup: (...a: unknown[]) => placeInGroup(...(a as [])),
  unplaceFromGroup: (...a: unknown[]) => unplaceFromGroup(...(a as [])),
  setRideStatus: (...a: unknown[]) => setRideStatus(...(a as []))
}));

/**
 * Assignment board (Plans/Event-Logistics.md §A/§B). Drag-and-drop is the
 * browser's business; what is asserted here is the state the board derives
 * and the dropdown fallback — the phone/keyboard path that has to work even
 * where drag does not.
 */
function person(over: Partial<BoardPerson> & { entryId: number; name: string }): BoardPerson {
  return {
    participantClass: 'scout',
    status: 'yes',
    participation: 'full',
    drivesOut: false,
    drivesBack: false,
    vehicleSeatsOut: null,
    vehicleSeatsBack: null,
    rideOut: 'needs_ride',
    rideBack: 'needs_ride',
    phone: null,
    ...over
  };
}

const driver = person({
  entryId: 1,
  name: 'Jason Porter',
  participantClass: 'adult',
  drivesOut: true,
  vehicleSeatsOut: 3,
  rideOut: null,
  phone: '(414) 555-0100'
});
const people: BoardPerson[] = [
  driver,
  person({ entryId: 2, name: 'Anjali' }),
  person({ entryId: 3, name: 'Owen' }),
  person({ entryId: 4, name: 'Violet', rideOut: 'self' }),
  person({ entryId: 5, name: 'Gone', status: 'cancelled' })
];
const carSet: BoardSet = {
  id: 10,
  label: 'Cars there',
  kind: 'car',
  leg: 'out',
  selfSelect: false,
  familyVisible: true,
  groups: [{ id: 100, name: 'Jason Porter', capacity: 3, driverEntryId: 1, notes: 'pulling trailer', memberEntryIds: [1, 2] }]
};
const tentSet: BoardSet = {
  id: 11,
  label: 'Tents',
  kind: 'tent',
  leg: null,
  selfSelect: false,
  familyVisible: true,
  groups: [
    { id: 200, name: 'Tent A', capacity: 2, driverEntryId: null, notes: null, memberEntryIds: [2, 3] },
    { id: 201, name: 'Tent B', capacity: null, driverEntryId: null, notes: null, memberEntryIds: [] }
  ]
};

beforeEach(() => {
  placeInGroup.mockClear();
  unplaceFromGroup.mockClear();
  setRideStatus.mockClear();
});

describe('AssignmentsBoard — cars', () => {
  it('CarBoard_ShowsUnplacedRidersInThePool_AndTheDriverOnTheCar', () => {
    render(<AssignmentsBoard signupId={1} calendarEntryId={2} sets={[carSet]} people={people} />);
    const pool = screen.getByLabelText('Needs a ride');
    expect(within(pool).getByText('Owen')).toBeTruthy();
    expect(within(pool).queryByText('Anjali')).toBeNull(); // placed
    expect(within(pool).queryByText('Violet')).toBeNull(); // driving separately
    expect(within(pool).queryByText('Gone')).toBeNull(); // cancelled
    const car = screen.getByLabelText('Jason Porter');
    expect(within(car).getByText('driver')).toBeTruthy();
    expect(within(car).getByText('(414) 555-0100')).toBeTruthy();
    expect(within(car).getByText('2 of 3 · 1 open')).toBeTruthy();
  });

  it('CarBoard_TilesMatchTheSheetMath', () => {
    render(<AssignmentsBoard signupId={1} calendarEntryId={2} sets={[carSet]} people={people} />);
    // riders = Anjali + Owen (2); placed 1; room = 3-1 = 2; self = Violet
    expect(screen.getByText('1 placed · 1 still to place')).toBeTruthy();
    expect(screen.getByText(/1 car · 0 to spare/)).toBeTruthy();
    expect(screen.getByText(/1 driving separately/)).toBeTruthy();
  });

  it('Board_DropdownFallback_PlacesPerson', async () => {
    const user = userEvent.setup();
    render(<AssignmentsBoard signupId={1} calendarEntryId={2} sets={[carSet]} people={people} />);
    await user.selectOptions(screen.getByLabelText('Move Owen'), '100');
    expect(placeInGroup).toHaveBeenCalledWith(100, 3, 1, 2);
  });

  it('Board_RemoveButton_UnplacesRider_NeverTheDriver', async () => {
    const user = userEvent.setup();
    render(<AssignmentsBoard signupId={1} calendarEntryId={2} sets={[carSet]} people={people} />);
    await user.click(screen.getByLabelText('Remove Anjali from Jason Porter'));
    expect(unplaceFromGroup).toHaveBeenCalledWith(100, 2, 1, 2);
    expect(screen.queryByLabelText('Remove Jason Porter from Jason Porter')).toBeNull();
  });

  it('CarBoard_RideStatusSelect_ChangesThoseOnTheirOwn', async () => {
    const user = userEvent.setup();
    render(<AssignmentsBoard signupId={1} calendarEntryId={2} sets={[carSet]} people={people} />);
    await user.selectOptions(screen.getByLabelText('Ride there — Violet'), 'needs_ride');
    expect(setRideStatus).toHaveBeenCalledWith(4, 'out', 'needs_ride', 1, 2);
  });
});

describe('AssignmentsBoard — any other set', () => {
  it('GroupBoard_PoolIsEveryoneNotPlaced_AndFullGroupsAreDisabledInTheMove', () => {
    render(<AssignmentsBoard signupId={1} calendarEntryId={2} sets={[tentSet]} people={people} />);
    const pool = screen.getByLabelText('Unassigned');
    // Jason, Violet unplaced; Anjali + Owen in Tent A; Gone cancelled.
    expect(within(pool).getByText('Jason Porter')).toBeTruthy();
    expect(within(pool).getByText('Violet')).toBeTruthy();
    expect(within(pool).queryByText('Owen')).toBeNull();
    const move = screen.getByLabelText('Move Violet') as HTMLSelectElement;
    const tentA = [...move.options].find((o) => o.value === '200');
    expect(tentA?.disabled).toBe(true); // Full · 2 of 2
    expect(screen.getByText('Full · 2 of 2')).toBeTruthy();
  });

  it('Board_TabStrip_SwitchesSets', async () => {
    const user = userEvent.setup();
    render(<AssignmentsBoard signupId={1} calendarEntryId={2} sets={[carSet, tentSet]} people={people} />);
    expect(screen.getByLabelText('Needs a ride')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /Tents/ }));
    expect(screen.getByLabelText('Unassigned')).toBeTruthy();
  });
});
