<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
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
