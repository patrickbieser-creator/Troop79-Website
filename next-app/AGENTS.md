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
doesn't just lag — it lies. Remediation phases and open design questions:
`Plans/Admin-Design-System.md`. Also: `library.module.css` is imported by ~20 public routes
(signin, member, advancement reports…) — never restyle it from the admin side.
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
