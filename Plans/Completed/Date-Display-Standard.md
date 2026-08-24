# Date Display Standard

**Created:** 2026-08-24 (Patrick: "UTC dates and european formats slipping into lists and
display … make a list of the variations … suggest standardizing … and where a variant makes sense")
**Status:** COMPLETE 2026-08-24 — v1.88.1 (lib + 7 wrong-day fixes) and v1.88.7 (sweep of ~95 sites, UTC-"today" defaults → centralToday(), ESLint guard, styleguide Dates section). Move to Plans/Completed/ at end-session. Left as-is on purpose: calendar-import preview (shows the file's own ISO), lib/dates.ts formatShortDate/formatLongDate (still exported; no src/app callers of formatShortDate remain), utility-date.tsx (visitor's own clock, eslint-disabled with reason).

## Inventory (2026-08-24 sweep, ~95 render sites, 40+ helpers)

**21 distinct visible formats.** No date library; every helper is hand-rolled Intl / string slicing.

| Format | Example | Sites |
|---|---|---|
| raw ISO | `2026-07-12` | **36** |
| long + weekday | `Sunday, July 12, 2026` | 12 |
| long | `July 12, 2026` | 20 |
| medium | `Jul 12, 2026` | 18 |
| medium, no year | `Jul 12` | 9 |
| month + year | `Jul 2026` / `July 2026` | 10 |
| split parts (badge) | `JUL` `12` | 9 |
| slash | `7/12/26` · `7/12/2026` · `07/12/2026` · `07/12/26` | 22 (four variants) |
| weekday + medium | `Sun, Jul 12, 2026` · `Sun, Jul 12` · `Sunday, Jul 12` | 4 |
| job-board | `Wed 9/2` · `Wed Sep 2 · 5:00 PM–7:30 PM` | 11 |
| date-time | `7/12/26, 3:04 PM` · `Jul 12, 2026, 3:04 PM` · `Jul 12, 3:04 PM` | 5 |
| browser default (can be DD/MM) | `12/07/2026, 21:04` | 1 — `meeting-plan/plan-view.tsx:193` |

### Bugs (correctness, not style)
**Hard UTC-day bugs** (shows the wrong day for Milwaukee users):
- `(public)/library/mb-grid.tsx:115, 127` — `new Date(dateCol)` client-side → previous day / wrong month on the 1st
- `(public)/library/_components/resource-card.tsx:38` — created_at, no timeZone
- `(public)/events/[id]/page.tsx:227` — signup deadline, no timeZone (7 PM CT deadline shows next day)
- `admin/(workspace)/events/actions.ts:507` — deadline in the reminder EMAIL, UTC clock (6 h off)
- `(public)/scouts/[id]/page.tsx:374` and `admin/snapshot/[id]/snapshot-document.tsx:267` — "today"/"printed on" via `new Date()` on the server, no timeZone → after 7 PM CT prints tomorrow's date

**Latent UTC-day** (server runs UTC today, breaks if it doesn't; or month-boundary only): library rank pages ×4, narrative updated_at ×2, admin library ×3, dashboard attention-items ×5.

**`.slice(0,10)` on a timestamptz** (ISO string AND UTC day): reimbursement-queue:77, passkey-manager:95, ledger-table:289, row-actions:193, records-table:149, articles-table:150, access-table:104, money-panel:458, report archive:50, scoutbook-export:180.

**No timeZone, client-side** (browser tz — fine for Milwaukee users, wrong for a travelling leader): duplicate-audit-card, pending-update-panel, report-workspace, court-of-honor-workspace ×3, profile editors ×2, entered-by-cell, audit-tape header.

## Proposed standard

One module, `src/lib/format-date.ts`, Central-pinned, two input kinds handled explicitly:
- **`date` columns** (`'YYYY-MM-DD'`): NEVER `new Date(s)`. Parse fields, format via Intl with `timeZone:'UTC'` on a `T12:00:00Z` instant (the pattern `lib/dates.ts` and the roster helpers already use).
- **timestamptz** (ISO instant): always `timeZone: 'America/Chicago'`.

| Helper | Output | Use for |
|---|---|---|
| `fmtDate(d)` | `Jul 12, 2026` | **the default** — every table cell, list row, hint, tooltip, dialog copy |
| `fmtDateLong(d)` | `July 12, 2026` | editorial/public prose: article bylines, report headers, print "Printed on" |
| `fmtDateFull(d)` | `Sunday, July 12, 2026` | page headings where the weekday matters: meeting pages, masthead, agenda |
| `fmtDay(d)` | `Sun, Jul 12` | dense day headings with weekday: job boards, slot-first day groups, deadlines |
| `fmtDateTime(iso)` | `Jul 12, 2026, 3:04 PM` | any timestamp shown with its time: logins, entered-at, submitted-at, deadlines |
| `fmtMonthYear(d)` | `July 2026` | photo almanac, narrative "updated", library "earned" badges |
| `fmtDateParts(d)` | `{JUL, 12}` | the calendar badge (keep `formatCalendarDateParts`) |
| `fmtRange(a,b)` | `Jul 12–14, 2026` / `Jul 30 – Aug 2, 2026` | multi-day events, report ranges, first–last txn |

**Retire:** all four slash variants (`7/12/26` etc. — the scout page's 10 sites and the audits move to `Jul 12, 2026`; the compact one saves 3 chars and costs the reader a parse), the zero-padded `07/12/2026`, the 2-digit-year `07/12/26`, `Wed 9/2`, and every raw ISO render. ISO `YYYY-MM-DD` survives ONLY in: CSV/Scoutbook exports, `<time dateTime>`/machine attrs, URL params, import previews (calendar-import shows what the file said — arguably keep ISO there, it IS the source format), and the date-picker's value.

**Where a variant is right:**
- `JUL 12` split badge on calendar cards — deliberate design element, keep.
- `Jul 12` without year inside a list that is visibly one year (attention items, agenda) — allowed via an option `{year:false}`, never as a separate helper.
- Print pages: long form for headings, `fmtDate` in tables (same as screen).
- Emails: `fmtDateTime` with an explicit " Central" suffix once, since the reader may be anywhere.
- `Wed Sep 2 · 5:00 PM–7:30 PM` (jobWhen) — keep the shape, route the date part through `fmtDay`.

## Build order
1. `lib/format-date.ts` + tests (both input kinds, DST both sides, month/year boundaries, range collapsing). Retire `lib/dates.ts` formatters into it (keep `centralToday`).
2. Fix the 6 hard UTC-day bugs + the email (correctness first, one commit).
3. Sweep raw ISO (36 sites) → `fmtDate` — mechanical, one commit per area (finance, advancement, calendar/rosters, public member).
4. Sweep `.slice(0,10)` and no-timeZone sites → `fmtDate`/`fmtDateTime`.
5. Retire slash formats (scout page, audits, dashboard, audit tape) → `fmtDate`.
6. Add the table to /admin/styleguide + a "Dates" rule to next-app/AGENTS.md; ESLint `no-restricted-syntax` for `toLocaleDateString(` / `toLocaleString(` / `.slice(0, 10)` outside lib/format-date.
