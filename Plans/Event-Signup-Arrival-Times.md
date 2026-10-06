# Event signup: when people arrive and leave, and cars by departure

**Status:** Parked
**Parked:** 2026-10-06
**Priority:** Medium

## Overview

The signup records transport as two legs per person — There and Back — each either *driving (N seats incl.
the driver)* or a ride status (Needs a ride / Driving separately / Meeting there / Not traveling)
(`lib/transport.ts`, `event-signup.ts`; Plans/Completed/Event-Logistics.md §A). A car is a group on a leg;
placing someone in it satisfies a "needs a ride". What a leg cannot say is **when**: an adult arriving a day
late who can drive scouts home is "Driving separately" on There and "driving, 4 seats" on Back, and nothing
on the board, the sheet or the roster distinguishes a Saturday-morning car from a Friday-evening one.
Partial attendance (which nights) is not recorded.

## Problem / Opportunity

Patrick, 2026-10-06: "How does the Signup currently handle adults and scouts who are driving to an event a
day late but can drive scouts home? The system should be able to keep track of who's coming and going and
how they're getting there."

## Acceptance Criteria

- [ ] Each leg carries a time: There = With the group · Later (day + time) · Meeting there; Back = With the
      group · Earlier (day + time). Defaults are the event's own times.
- [ ] The ride board groups cars by departure ("Friday 5:30 pm — 4 cars", "Saturday 9 am — Bieser, 3 seats")
      and a scout needing a Saturday ride is placed in a Saturday car.
- [ ] The campout sheet and the roster say it: "Arrives Sat 9 am (own car)", "Leaves Sat 4 pm with Bieser".
- [ ] Nights attended derive from the arrival/departure days (an offered number for Menu Monster's
      per-meal headcount — never a prefill; Patrick: headcounts stay manual).

## Test Plan

- [ ] `Leg_CarriesADepartureTime_DefaultingToTheEvents` (transport, pure)
- [ ] `Board_GroupsCarsByDeparture_AndPlacesANeedsRideInAMatchingWave`
- [ ] `Sheet_SaysArrivesAndLeaves_WithWhom`
- [ ] `Nights_DeriveFromArrivalAndDepartureDays`
- [ ] form: the Later / Earlier choice reveals a day + time; the existing statuses keep working

## Technical Approach

- Additive columns on `signup_entries`: `out_departs_at` / `back_departs_at` (timestamptz, null = with the
  group), kept beside `ride_out` / `ride_back`; "Driving separately" stays as the status, the time says when.
- Cars (`signup_groups`, kind='car', leg) gain `departs_at`; a driver's car inherits the driver's leg time.
- `transport.ts` stays pure: `wavesFor(leg, entries, cars)` groups by departure (null first = "with the
  group"); placement validation refuses a car whose wave differs from the rider's unless a leader overrides.
- Sheet / roster / snapshot read the same helpers. Deploy DB-first (additive).

## Implementation Steps

1. Schema + transport.ts helpers (test-first).
2. Family form: the Later / Earlier choice per leg.
3. Board waves + placement rule; sheet and roster lines.
4. Nights derivation and the Menu Monster "offered headcount" hook (separate release; needs Patrick's OK on
   how it is offered).

## Open Questions

- Should a leader be able to set a leg time on someone else's entry (the roster Money/Logistics tabs)?
- Is "Meeting there" still needed once "Later" exists, or does it collapse into Later with no car?
