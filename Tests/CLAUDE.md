# Tests — Troop79-Website

**Last Updated:** 2026-08-15
**Framework:** Vitest, in two projects — `db` (Node, against a local `supabase start` Docker instance) and `dom` (jsdom + Testing Library).

---

Read this before writing any tests for this project.

## Which project does my test belong in?

Split by file extension, configured in `next-app/vitest.config.ts`:

| Extension | Project | Environment | Use it for |
|-----------|---------|-------------|------------|
| `*.test.ts` | `db` | node | Anything touching Supabase, plus pure-function unit tests |
| `*.test.tsx` | `dom` | jsdom | Rendering a client component and driving it |

Run one project with `npx vitest run --project dom`.

**The `dom` project exists because state bugs are invisible to the `db` one.**
D-098 shipped one household member's values under another member's name while
every row in the database was correct — only a renderer sees state leaking
between selections. If a bug's symptom is "the screen showed the wrong thing"
rather than "the data is wrong", it belongs in a `.test.tsx`.

Rules for `dom` tests:

- **Client components only.** `page.tsx` files are async Server Components and
  cannot be rendered by Testing Library. Render the `'use client'` component
  the page mounts, and pass its server actions in as `vi.fn()`.
- **Query by accessible name** (`getByLabelText`, `getByRole`), not by class or
  test id. That is what caught the label markup folding "awaiting review" into
  every pending field's accessible name.
- **`tests/setup-dom.ts` is required, not decorative** — this suite runs with
  Vitest globals off, so Testing Library's automatic cleanup never registers
  and components would leak between tests in a file. See the file's own note.
- Falsify a new regression test before trusting it: break the line it guards,
  confirm that test and only that test fails, then restore.

## Test Framework

Vitest, integration-style — not unit tests. Tests call supabase-js the same
way Server Actions and RPCs are called in production code; the DB layer is
never mocked. Chosen (tech-lead, 2026-07-20) over pgTAP because every target
behavior — including the two-transaction concurrency case for D-033's
capacity lock — is reachable through the exact call path production code
already uses (`.rpc(...)`), and a second SQL-native test runner is not worth
standing up for a solo-dev project with no CI yet. Revisit pgTAP only if
DB-invariant coverage grows large enough that the supabase-js boundary
becomes the bottleneck (see `feedback-simplify-dont-layer` in project
memory — don't add a second system before the first is proven insufficient).

`vitest.config.ts` loads `.env.local` via `process.loadEnvFile()` (Node 24),
so tests read the same `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
that point at the local Docker instance in dev.

## Running Tests

```
cd next-app
npm run supabase:start   # if not already running
npm run test
```

Requires local Supabase to be running (`supabase start`) — for the `db`
project. The `dom` project needs nothing but `npm install`, so
`npx vitest run --project dom` works with Docker down. Tests never run
against the hosted production project — there is no environment switch to
get this wrong; the local `.env.local` only ever points at `127.0.0.1`.

## Test Naming Convention

`{Subject}_{ExpectedBehavior}_When{Condition}()` — e.g.
`Signup_RejectsSecondEntry_WhenSamePersonAlreadyRegistered`. Matches the
acceptance-criteria-first convention in `disciplines/development.md`.

## Fixture Locations

No shared fixture files yet. Each test creates the exact rows it needs
(a throwaway `calendar_entries` / `event_signups` / `people` row, etc.) in a
`beforeEach`/`beforeAll` and deletes them in `afterEach`/`afterAll` — tests
must never depend on, or leave behind, real troop data. This mirrors the
"revert test inserts" rule already followed for manual browser verification
(see `feedback-test-data-cleanup` in project memory).

## Coverage Thresholds

| Component | Minimum |
|-----------|---------|
| Core / API | 100% |
| Domain | 95% |
| Features | 85% |
| UI | 70% |

These mirror org minimums in `development.md`. Not yet enforced by tooling —
there is no coverage gate wired up (no CI). First priority is covering the
identity-critical RPCs (submit/cancel signup, merge/accept import rows), not
hitting a percentage.

## Mock Boundaries

Mock external HTTP calls only (Resend email sending). Never mock Supabase —
these are integration tests against a real local Postgres; that IS the point.

In `dom` tests, the mock boundary is the **server action**: pass `vi.fn()` for
each action prop and assert on the `FormData` the component built. What the
action then does with it is the `db` project's business — don't reimplement the
diff rules client-side in a test, or the two will drift.

## Anti-Patterns to Avoid

- Don't assert against real troop data (scout names, real households) — the
  fixture stays self-contained so tests are safe to run against a dev
  database that also has real seed data loaded.
- Don't leave rows behind on a failed assertion — use `afterEach` cleanup
  that runs regardless of whether the test body threw, not just on success.
