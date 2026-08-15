-- Article typography tokens — editable prose styling without a deploy.
--
-- WHY (Operator, 2026-08-14)
-- Patrick asked for the markdown stylesheet to be editable from admin. The
-- literal version does not work here: Vercel's filesystem is read-only at
-- runtime, so it would mean storing CSS in the database and injecting it — and
-- CSS has no syntax gate, so one unclosed brace silently swallows every rule
-- after it, with no build step or test to catch it. Injected CSS is also an
-- exfiltration surface (`url()` makes requests; attribute selectors leak page
-- content a character at a time).
--
-- So this stores VALUES, never rules. `lib/article-tokens.ts` gives each token
-- a type and refuses anything that fails it, on write AND again on render, so
-- nothing arbitrary can reach a stylesheet.
--
-- Key/value rather than one column per token: adding a token is then two lines
-- of TypeScript and a var() in the stylesheet, with no migration. The set of
-- valid keys lives in code, which is also where the validators live — a row
-- whose key no code knows is simply ignored.
--
-- DELIBERATELY UNSEEDED. An absent row means "use the stylesheet's own
-- fallback", so the defaults have exactly one home (the CSS) instead of two
-- that can drift. The panel shows those fallbacks as placeholders.

create table public.article_style_tokens (
  token      text primary key,
  value      text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

comment on table public.article_style_tokens is
  'Typography values for the article/markdown renderer, edited under Lookups & Admin. Values only — never CSS rules. Every value is validated against its token type in lib/article-tokens.ts before storage and again before rendering; an invalid or unknown row is ignored and the stylesheet fallback wins. An absent row means "use the default".';

alter table public.article_style_tokens enable row level security;
-- Readable by anyone: these are presentation values rendered into every public
-- article page. Writes stay service-role only, like every other lookup.
create policy article_style_tokens_read_all
  on public.article_style_tokens for select using (true);
