# Recent Logins Dashboard — Plan

**Status:** Design confirmed 2026-08-17 (Patrick), parked mid-task while Court of Honor was being built. Not started.

## Requirement

New section on the admin dashboard: last 15 logins (family + admin — same underlying system since the Phase E identity unification, so this is one list, not two merged sources), with a "view all" link. Plus a CSV-adjacent detail set, confirmed by Patrick.

## Data model finding (investigated 2026-08-17, still valid)

- `login_tokens` (magic link / code): genuine per-event history already (`created_at` + `consumed_at`), reliable.
- `passkey_credentials.last_used_at`: only the latest login per credential — **no history**, overwritten every time.
- Admin/leader login is now the SAME flow as family login (Phase E, 2026-08-16) — no separate admin login event type exists; "leader vs. family" is a capability property of the person, not the login event.
- No existing "who's logged in" UI anywhere to extend.

**Conclusion:** build a new `login_events` table that both the `login_tokens` redemption path (`src/lib/identity-challenge.ts` — `redeemToken()`, `redeemCodeForTarget()`) and the passkey verify path (`src/lib/passkeys.ts`, the sign-count/`last_used_at` update) insert into on success. Gives clean, symmetric history for both methods going forward — a straight union of the two existing sources was rejected because it undercounts passkey users (one row per credential regardless of how many times they've actually logged in).

## Confirmed field set (Patrick, 2026-08-17)

- Login method (magic link / code / passkey)
- Role at time of login (leader / parent / scout — capability snapshot, not live-looked-up later)
- Device / browser (needs adding — not captured anywhere today; parse from user-agent)
- First-time-login flag
- Failed/abandoned attempts — Patrick confirmed this is wanted, but as a **distinct signal**, not mixed into the main "last 15 successful logins" list (repeated failures on one person is the security-relevant case, not routine noise)

Not yet asked: whether IP address should be captured/shown (raised as a suggestion, admin-eyes-only if included — no explicit confirmation yet).

## Next steps when this is picked back up

1. Design `login_events` migration: person_id, method, role_snapshot, device/browser (parsed), success bool, ip (tbd), created_at. Consider whether failed attempts get their own row in the same table (success=false) or a separate concept.
2. Wire inserts into `identity-challenge.ts` (token redemption) and `passkeys.ts` (passkey verify) — both success and failure paths.
3. New admin dashboard section + "view all" page.
4. This is auth-adjacent — qa-lead review is mandatory before shipping (security mandate, not skippable by proportionality).
