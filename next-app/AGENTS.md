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

Reference implementations: `src/app/(public)/events/[id]/person-first-form.tsx` (draftKey snapshot)
and `slot-first-form.tsx` (claims/comments/guests keys). The Guests section's "locked until someone
attends" placeholder is the same principle applied to a section. An audit of every other form
against this rule is on the backlog.
