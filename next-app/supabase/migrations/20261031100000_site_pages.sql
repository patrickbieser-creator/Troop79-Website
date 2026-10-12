-- Content-managed pages, phase 1 (Plans/Content-Managed-Pages.md). Patrick, 2026-10-11.
--
-- /join and /about were hard-coded JSX; every copy change was a Claude session and a deploy. site_pages holds
-- their copy (and any new child page) as markdown, edited from /admin/news/pages with the same markdown editor
-- the news CMS uses.
--
--   body_md      the main column. Conventions (src/lib/article-body/PageBody.tsx): `## ` = section divider; a
--                top-level `1.` list = numbered steps (leading **bold** = the step title); `### ` + paragraph =
--                FAQ; {{cta: Headline | sub | Label->/href | ...}} and {{stats: 2022::Founded | ...}} blocks.
--   sidebar_md   split on `## ` into sidebar modules; a `- **Label** value` list is the fact card; paragraphs
--                are notes.
--   path         unique, the public URL ('/join', '/about/history'); parent path + '/' + slug.
--   show_in_nav  reserved for phase 3 (site nav from the tree) so that phase needs no migration. No UI yet.
--
-- DEPLOY ORDER: DB-first. /join and /about read their rows with no JSX fallback, so this migration (with its
-- seed) must be live before the code that reads it.
-- Posture (D-051 / D-239): RLS on, ZERO policies, service role only; table privileges revoked from the API
-- roles as well.
--
-- audit_log gains the 'pages' area so every save can write a from/to audit row (area check widened).

create table if not exists public.site_pages (
  id bigserial primary key,
  parent_id bigint references public.site_pages(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  path text not null unique check (path ~ '^/[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$'),
  title text not null,
  headline text not null default '',
  lede text not null default '',
  body_md text not null default '',
  sidebar_md text not null default '',
  meta_description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  sort_order integer not null default 0,
  show_in_nav boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
create index if not exists site_pages_parent_idx on public.site_pages (parent_id, sort_order);

alter table public.site_pages enable row level security;
revoke all on public.site_pages from anon, authenticated;
revoke all on sequence public.site_pages_id_seq from anon, authenticated;

alter table public.audit_log drop constraint if exists audit_log_area_check;
alter table public.audit_log
  add constraint audit_log_area_check check (area in ('news', 'calendar', 'roster', 'library', 'menus', 'pages'));

-- ── Seed: today's /about and /join copy, converted to the markdown conventions ───────────────────────────
-- Every sentence, link, email and maps URL is carried over. title doubles as the page's section label
-- ("Join Troop 79" over the headline); meta_description is the old <meta name="description">.

insert into public.site_pages (slug, path, title, headline, lede, body_md, sidebar_md, meta_description, status, sort_order, updated_by)
values (
  'about',
  '/about',
  'About the Troop',
  'A family troop, growing up together.',
  $md$Scout Troop 79 is a family Scouts America troop on Milwaukee’s East Side — about thirty scouts, twenty-five families, and the adult volunteers who keep it all moving. We welcome boys and girls of all backgrounds, and most of us are learning this together.$md$,
  $md${{stats: 2022::Founded | ~30::Scouts | 25::Families | 10::Adult Leaders}}

## Who We Are

Troop 79 was founded in 2022 and is chartered through Scouts America. We’re a **family troop**: siblings scout side by side, parents pitch in, and whole families show up for campouts and service days. Some of our scouts arrived with years of Cub Scouting behind them, but plenty walked in never having tied anything more ambitious than a shoelace.

What holds it together is the Sunday meeting — a ninety-minute stretch of skills, recognition, games, snacks and the occasional controlled chaos that scouting is built on.

## Scout-Led, Adult-Supported

Scouts are organized into patrols, plan the meetings, and — this is the part that surprises new families — are deeply involved in running the troop. Older scouts help lead skill instruction at meetings, from knots and first aid to cooking and navigation. Adults stay close, mentor, and handle the things that need a more experienced hand.

## What We Do

Between Sunday meetings the troop calendar fills with campouts, day outings, service projects, and fundraisers. Scouts work through the ranks — Scout to Eagle — and earn merit badges along the way, taught by troop adults, and outside experts. The [troop calendar](/events) always has what’s coming next.

## Advancement, In the Open

This website is more than a newsletter. Every requirement a scout completes is recorded here, and families can follow progress on the [advancement tracker](/advancement) and the [merit badge library](/library) any time — no waiting for a court of honor to find out how close a rank is.

{{cta: Thinking about joining? | Your family’s first Sunday meeting is step one — no experience or commitment required. | How to Join Troop 79->/join}}$md$,
  $md$## At a Glance

- **Chartered** Scouts America
- **Who** Boys & girls, ages 11–17
- **Meetings** Sundays, 4:00–5:30 PM
- **Where** Northwoods\
  1572 E Capitol Drive\
  Shorewood, WI

## Leadership

**Mindy Stollenwerk**, Scoutmaster, leads the adult team, and **Jack Kosmoski**, Committee Chair, leads the parent committee behind it. Reach the troop at [bsatroop79bg@gmail.com](mailto:bsatroop79bg@gmail.com).

## Come Visit

The best way to meet Troop 79 is in person — drop in on any Sunday meeting. [Here’s how joining works →](/join)$md$,
  'Scout Troop 79 is a family Scouts America troop in Milwaukee, Wisconsin — about 30 scouts and 25 families meeting Sundays on the East Side.',
  'published',
  10,
  'seed'
)
on conflict (path) do nothing;

insert into public.site_pages (slug, path, title, headline, lede, body_md, sidebar_md, meta_description, status, sort_order, updated_by)
values (
  'join',
  '/join',
  'Join Troop 79',
  'Step one: just show up.',
  $md$There’s no application to fill out before you visit and nothing to buy. Joining Troop 79 starts with your family walking into a Sunday meeting and seeing whether it feels right.$md$,
  $md$## How Joining Works

1. **Visit a Sunday meeting**
   We meet most Sundays from 4:00 to 5:30 PM at Northwoods, [1572 E Capitol Drive, Milwaukee](https://www.google.com/maps/search/?api=1&query=1572+E+Capitol+Drive%2C+Milwaukee%2C+WI). Check the [calendar](/events) to confirm we’re meeting that week, then walk in and ask anyone for the Scoutmaster. Come once or come three times — visiting is free and nobody will chase you with paperwork.
2. **Say hello**
   Questions before (or after) you visit? Email the troop at [bsatroop79bg@gmail.com](mailto:bsatroop79bg@gmail.com) and a real parent volunteer will get back to you.
3. **Register with Scouts America**
   When your scout is ready to join, there’s a short application and an annual registration fee. Our leaders will sit with you and walk through the paperwork — it takes one evening, not a season.
4. **Jump in**
   Get a handbook, meet your patrol, and start on the first requirements. Every one your scout completes shows up on the troop’s [advancement tracker](/advancement), so your family can follow progress from day one.

## Who Can Join

Troop 79 welcomes **boys and girls of all backgrounds**, generally ages 11 through 17. Younger kids who are 10 and have finished fifth grade (or earned the Arrow of Light) can join too. Not sure where your scout fits? [Ask us](mailto:bsatroop79bg@gmail.com) — we’ll sort it out.

## Common Questions

### Does my scout need any experience?
No. Plenty of our scouts joined without a single night of Cub Scouting. The program starts from the beginning, and older scouts do the teaching.

### What does it cost?
There is an annual Scouts America registration fee, and individual outings have their own costs depending on the activity. Email us and we’ll walk you through the current numbers before you commit to anything.

### Can parents stay?
Yes — we’re a family troop. Parents are welcome at every meeting, and many end up helping with campouts, driving, or the committee. Siblings scout side by side here.

### Can we join partway through the year?
Any time. Advancement is self-paced, so a scout who joins in February isn’t behind anyone — they just start where they are.

{{cta: Come say hi this Sunday. | 4:00 PM at Northwoods, 1572 E Capitol Drive — or send a note and we’ll save you a seat. | Email the Troop->mailto:bsatroop79bg@gmail.com | Check the Calendar->/events}}$md$,
  $md$## When & Where

- **Day** Most Sundays
- **Time** 4:00–5:30 PM
- **Place** Northwoods\
  [1572 E Capitol Drive](https://www.google.com/maps/search/?api=1&query=1572+E+Capitol+Drive%2C+Milwaukee%2C+WI)\
  Milwaukee, WI
- **Email** [bsatroop79bg@gmail.com](mailto:bsatroop79bg@gmail.com)

## New Here?

Get to know the troop first — who we are, how scouts lead, and what a year with Troop 79 looks like. [About the troop →](/about)$md$,
  'How to join Scout Troop 79 in Milwaukee, Wisconsin: visit a Sunday meeting, say hello, and register with Scouts America. Boys and girls ages 11–17 welcome.',
  'published',
  20,
  'seed'
)
on conflict (path) do nothing;
