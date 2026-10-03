# Menu Monster — superuser proxy as a scout

**Status:** Parked (2026-10-03). Not started.
**Priority:** TBD
**Origin:** Patrick, 2026-10-03: "Ability for superusers to proxy as a scout in the menu monster."

## Overview

Let a superuser act as a chosen scout inside Menu Monster: see and edit that scout's menus and recipes exactly as the scout would (help a scout who can't sign in, fix a menu, demo the workspace).

## Open Questions

- Which capability counts as "superuser" here (the existing superuser / household-switch holders, cf. `householdSwitchAllowed` in `lib/family-access.ts`)?
- Scope: Menu Monster only, or a general "view as scout" that other scout-facing pages reuse?
- Writes: every write today takes the owner from `requireVerifiedScoutIdentity()` — a proxy needs a server-side "acting as" that every menu/recipe action honours, and audit rows that name BOTH the superuser and the scout ("Pat B. as Sam K. shared menu…").
- How is the proxy shown on screen (a persistent banner + "Stop acting as Sam K.")? Session lifetime?
- Price reports while proxying: should they move the shared price book, or be held?

## Test Plan

TBD — at minimum: non-superuser cannot proxy; proxy writes are owned by the scout and audited with the superuser; proxy ends cleanly.

## Implementation Steps

TBD — tech-lead + qa-lead review first (it is an auth change).
