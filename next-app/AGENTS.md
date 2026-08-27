<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Admin styling: tokens + styleguide are load-bearing (2026-08-21)

Before styling anything under `src/app/admin/`, know the rules in
`src/app/admin/(workspace)/admin.css` (the `--admin-*` token sheet on `:root` — single source
of truth) and the pattern library at `/admin/styleguide`
(`(workspace)/styleguide/page.tsx`). In short: no raw hex in admin CSS (add a token if none
fits); never read the public palette tokens (`--navy`, `--forest`, `--bark`,
`--transition`…) from admin styles; spacing/font sizes/radii come from the token scales;
check the styleguide for an existing pattern before writing a new class; inline
`style={{…}}` only for genuinely dynamic values.

**Buttons and form surfaces are components, not classes (2026-08-24):** every admin button is
`<Button>` from `src/app/admin/_components/button` — variants primary (navy) / secondary /
danger (outlined) / dangerSolid (danger-Dialog confirm only) / quiet, sizes md / sm, `href`
renders a Link; `SaveButton`/`DiscardButton` render it already. Every surface that holds fields
is `<FormPanel>` or the numbered `<FormSection>` from `admin/_components/form-panel`; any admin
edit form with more than one group of fields uses numbered `<FormSection>`s (1, 2, 3…, as the
scout and news editors do) rather than one long run of fields. Both live
one level ABOVE `(workspace)` so `/admin/roster-print` and `/admin/snapshot` can use them. Do not
add a `.xyzBtn` / `.panel` class to a screen stylesheet — add a variant to the component and a
row to the styleguide scoreboard. Genuinely different controls (icon buttons, chips, sort
headers, toggles, tab strips) keep their own classes.

**On-screen instructions (2026-08-25):** before writing instructional prose on an admin screen,
decide where it belongs, in this order (Brad's ladder): a leader must know it BEFORE acting (a gate,
a consequence, an irreversible step) → visible text: the lede, a field hint, a Notice — never hidden;
what the screen is for, in ≤ 2 sentences → the `PageTitle` lede; nothing here yet → the empty state
carries it; the meaning of a symbol, column or disabled control → a `<HelpBadge id="…">` beside that
thing, copy in `admin/help.tsx`; a paragraph of "how this section behaves" → a collapsible disclosure
(useState toggle, D-070); otherwise leave it out. Default when undecided: a help badge — but never
more than one per row or section, and not twenty identical ⓘs that all read as "skip me".
Specimens: `/admin/styleguide/admin` → Help Badge; tuning page `/admin/styleguide/help-sample`.

**List search is one component (2026-08-25):** a small, already-fetched table (the roster tabs,
lookups) filters on the client with `useTableSearch(rows, fields)` + `<SearchField>` from
`_components/search-field` — placeholder "Search by name…", `type="search"`, a real `aria-label`,
Esc clears, "N of M" announced. It sits in the table's toolbar row: after any sub-tab strip or
count, before the spacer and the Add button — the same slot on every screen. Server-listed
screens (Calendar, News, Ledger) keep their URL-debounced `q` (tab counts follow the filter, the
view is linkable); don't mix the two on one screen. One exception by design: the Roster has a single
`RosterSearch` ABOVE its TabStrip (2026-08-27) that spans every tab and deep-links a hit to
`?tab=X&open=ID` — its tabs carry no search of their own; don't add one back.

**Back navigation is one slot (2026-08-25):** `PageTitle` requires `back` — `null` on a list/root
page (it then remembers its URL for children), `{ label, href }` on a depth-2 screen ("← Back to
News"), `{ crumbs: [root, parent], current }` at depth 3+ (breadcrumbs). It renders `BackNav` above
the h1; screens without `PageTitle` (the calendar workbench head) render `BackNav` themselves in the
same spot. Never put a back link in `children`, `sub`, a toolbar, or a page footer. Forms get the
Discard-changes prompt for free through the save-state hooks (`useRegisterDirty`). Specimen:
`/admin/styleguide/admin` → Back Navigation.

**Admin → public links are one component (2026-08-25):** `PublicPageLink` from
`admin/_components/public-page-link` — secondary / sm, same tab, "View public page" or "Preview
(unpublished)" for a draft, never hidden. It goes in `PageTitle`'s children (the right-side actions)
or the screen's `.headActions` when there is no PageTitle; never in `sub`, never a hand-rolled
`<Link>`. Specimen: `/admin/styleguide/admin` → Back Navigation → Public Page Link.

**Tables are seven named patterns, one stylesheet (2026-08-25):** DataTable·Compact, DataTable·Card,
DataTable·Dense Grid, RecordList, Board, ExpandableSummary, PrintTable — specimens under Data Tables on
`/admin/styleguide/admin`. The three `<table>` patterns live in
`(workspace)/_components/data-table.module.css` (`.compact`, `.card` + `.cardWrap`, `.dense`, and the
cell behaviours `.rowLink` / `.actionsCell` / `.numCell` / `.empty`). A screen adopts one with
`composes` on its own `.table` class (`.table { composes: card from '../_components/data-table.module.css'; }`,
`.tableWrap { composes: cardWrap … }`) — markup unchanged. **No new per-screen table rules**: a screen
keeps only genuine extras (column widths, sticky thead, responsive hides), and an override of a shared
declaration uses the doubled selector (`.table.table td`) so it wins regardless of bundle order. Numbers
are `.numCell`, the Actions column is `.actionsCell`; RecordList is the `RecentItemsList` component,
ExpandableSummary is `finance/report/activity-report.tsx` (its header comment is the spec).

**Keep the styleguide in the same commit as the change:** adding a new admin UI pattern,
class family, token, or shared component means adding its specimen (and scoreboard row, if
it has variants) to the styleguide page; retiring a variant means deleting its specimen and
striking its row. The page imports real production stylesheets, so an un-updated guide
doesn't just lag — it lies. Remediation history: `Plans/Completed/Admin-Design-System.md`.
Also: there are TWO `library.module.css` files — the one at `src/app/(public)/library/` is
**library-routes-only** since Public Phase A (its old shell/form classes were promoted to
`src/app/_components/`; nothing outside `/library` imports it any more — keep it that way);
the admin workstation's own copy at `src/app/admin/(workspace)/library/` is admin-only
(3 importers) and is on admin tokens.

## Public styling: same discipline, public tokens (2026-08-21)

Before styling anything under `src/app/(public)/`, `src/app/_components/`, or the root
pages, know the rules in `src/app/globals.css` (the public token sheet on `:root` — palette,
`--fs-*` type, `--sp-*` spacing, `--rad-*` radii, `--status-*`, `--on-navy-*`,
`--font-*`/`--font-mono`, `--rule`, `--focus-ring`, and the 480/640/900 breakpoint canon)
and the pattern library at `/admin/styleguide/public`. In short: no raw hex in public CSS
(7 commented deliberates exist — don't add an 8th without a comment and a reason a token
can't serve); use the shared components in `src/app/_components/` (PageHeader, PageShell,
Button, Badge, TabStrip, Notice, EmptyState, SectionDivider, form kit + DateField, card)
instead of re-declaring their patterns; inline `style={{…}}` only for genuinely dynamic
values with a `/* dynamic */` comment (13 sanctioned sites exist); form inputs are 16px —
the iOS no-zoom floor — never smaller.

**The admin↔public firewall runs both directions** and is at ZERO leaks: public code never
imports from `src/app/admin/` and never reads `--admin-*`; admin CSS never reads the public
tokens. Exactly three sanctioned crossings, all documented in the Shared contracts section
of `/admin/styleguide/public`: (1) `admin.css`'s `--admin-preview-*` alias block (WYSIWYG
parity — changing those 8 public tokens restyles admin previews), (2) the DB-driven
`--article-*` prose namespace (`src/lib/article-body/`, both sides), (3)
`scout-accordion.module.css` (one report rendered identically in both places). The
`--font-playfair`/`--font-lora`/`--font-open-sans` variables are next/font infrastructure,
not palette tokens — both sides may read them. Keep both styleguides in the same commit as
any pattern change — same rule as admin. History: `Plans/Completed/Public-Design-System.md`.

**These rules are mechanically enforced, not advisory:** `eslint.config.mjs` fails any
admin import from public code, and `tests/design-system-census.test.ts` fails the build on
a new raw hex, a new inline `style={{}}` site, or a cross-side token read outside the
sanctioned allowlists. If your change trips one, the fix is a token, a class, or a shared
component — growing an allowlist requires the `/* deliberate */` comment at the site AND a
scoreboard note on `/admin/styleguide/public`, in the same commit.
<!-- END:nextjs-agent-rules -->

## Known gotcha: JSX drops the space after an inline element at a line wrap

When text following an inline element (`</Link>`, `</a>`, or a `{expr}` container)
wraps to the next source line, the space after the element is dropped in the
rendered HTML — "troop calendar</Link> always" renders as "calendaralways".
Always write an explicit `{' '}` after the element when the sentence continues:

```tsx
<Link href="/events">troop calendar</Link>{' '}
always has what&rsquo;s coming next.
```

Found via browser verification on 2026-07-12 (also caused the footer's
"© 2026Scout Troop 79"). Sweep check after adding prose with inline links:
`curl -s localhost:3000/<page> | grep -oE '</a>[^ ,.<;)]{1,25}'` should return nothing.

## People are the spine: contact details live on `people` only (2026-08-26)

A human's email, phone, address, birthdate, gender, BSA ID, health-form date, YPT date and
"things we should know" live on **`people`** (and `person_emails` for addresses — one `is_primary`
row per person, with `people.primary_email` kept as a trigger-maintained cache of it). `scouts`
carries only the scout's record (rank, patrol, school, swim class, junior leader, active) and
`leaders` only the leader's (code, role, login fields); `leaders.name` is a trigger-derived copy of
`people.display_name`. Household membership is `household_members` (scouts AND adults) — never a
`household_id` on a scout. **Never add a contact or demographic column to `scouts` or `leaders`**,
never read one from them, and never put a parent's address on a scout's record: a scout with no
email of their own has none, and the sign-in picker offers the household's parents instead. Write
demographics through `lib/write-person-demographics` (one writer for scouts and adults). Guard:
`tests/no-roster-contact-column-reads.test.ts`. Plan of record:
`Plans/Retire-Roster-Contact-Columns.md`; audit: `Plans/People-Model-Audit-2026-08-26.md`.

## Dates: one Central-pinned standard (2026-08-24)

Every human-visible date goes through `src/lib/format-date.ts` — `fmtDate` ('Jul 12, 2026', the
default for tables/lists/hints/dialogs), `fmtDateLong` (prose), `fmtDateFull` (weekday headings),
`fmtDay` ('Sun, Jul 12' — dense day headings, deadlines), `fmtDateTime`, `fmtMonthYear`, `fmtRange`.
Two input kinds, never confused: a `date` column ('YYYY-MM-DD') is a CALENDAR DAY (never
`new Date(s)` — UTC midnight is the evening before in Milwaukee); a timestamptz is an instant in
America/Chicago. "Today" for a default value is `centralToday()` from `lib/dates`, never
`new Date().toISOString().slice(0, 10)` (that is tomorrow after 7 PM). ISO 'YYYY-MM-DD' is for data
only — exports, URL params, picker values, the calendar-import preview. Slash forms are retired.
**Enforced by ESLint** (`no-restricted-syntax` on `toLocaleDateString`/`toLocaleTimeString` and the
UTC-today idiom under `src/app/**`); the helper table is on `/admin/styleguide/admin` → Dates.
Inventory + rationale: `Plans/Date-Display-Standard.md`.

## Save buttons: dirty-gated, labelled, and loud about what they did (2026-08-23)

Rule (Patrick, 2026-08-23, after the family sign-up form shipped a Save that "didn't change
color after a save"): **every Save / Submit / Apply control on a form that edits something
already saved follows one standard** — no exceptions, public or admin:

1. **Disabled until the draft differs from what is saved.** Snapshot the draft on mount (the page
   reloads after a save, so "on mount" IS "what is saved") and compare — `useState(() => draftKey)`
   + `draftKey !== savedKey`. Never read a ref during render (the React-compiler lint forbids it).
2. **The label says the state:** "Save changes" when dirty, **"Saved"** when clean (first-ever
   submit keeps its own verb, e.g. "Submit family signup", gated on "anything chosen").
   `title="No changes to save yet"` on the disabled state.
3. **Feedback while it works and when it lands:** show a "Saving changes…" status the moment the
   form submits and a brief "Done" flash when the page returns (public: `save-feedback.tsx`
   `SavingOverlay` + `SavedFlash`, keyed on `?saved=1`; admin forms use the same idea with the
   admin tokens — add an admin twin rather than importing across the firewall).
4. **A control that will do nothing is greyed, not hidden** — the user should see it exists and
   learn why it's off.
5. **A way back (Patrick, 2026-08-24):** every in-page form that stays open after saving has a
   **Discard changes** beside Save — greyed until dirty, and it returns the form to the LAST SAVED
   state (not what the page loaded with). Dialogs and inline row editors satisfy this with their
   Cancel: closing is discarding. Admin: `DiscardButton` + `useDraftSnapshot(draft).saved` for
   controlled forms, `useFormDirty(ref).reset()` for uncontrolled ones.

Reference implementations: `src/app/(public)/events/[id]/person-first-form.tsx` (draftKey snapshot)
and `slot-first-form.tsx` (claims/comments/guests keys). The Guests section's "locked until someone
attends" placeholder is the same principle applied to a section.

**Admin: use the shared pieces, don't hand-roll** (rolled out across every admin edit form
2026-08-24, v1.88.0–v1.88.6 — `Plans/Save-Button-Rollout.md` has the audit):
`src/app/admin/(workspace)/_components/save-state.tsx` — `useSavedSnapshot(draftKey)` for
controlled forms, `useFormDirty(formRef)` for uncontrolled `<form>`s, `SaveButton` (pass the
screen's own primary class; `isNew`/`newLabel` for a first save, `blocked`/`blockedReason` for a
required-field gate), `useSavePhase` + `SaveFeedback` for Saving… → Done (`doneThen(onClose)` in
dialogs so the Done shows before the dialog closes). Live demo: /admin/styleguide/admin → Save
Buttons. Create-once forms and one-click actions (Approve, Grant, Accept…) are NOT dirty-gated —
"anything filled in" and the click itself are their gates.
