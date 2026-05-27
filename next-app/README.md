# Troop 79 — Production App

Next.js 16 + Supabase port of the static prototype at the repo root. This folder
is the production target; the static prototype (`../index.html`, `../merit-badges.html`,
`../admin/advancement-leader.html`, …) remains the design reference until each
screen is fully ported.

## What's built so far (foundation)

- **Next.js 16 + TypeScript + Tailwind 4 + App Router**
- **Supabase schema migration** (`supabase/migrations/20260525000000_initial_schema.sql`)
  covering every table the prototype touches: scouts, ranks (+ requirements tree),
  merit_badges (+ requirements tree with `complete_rule`/`complete_n` optionality),
  ledger_entries (single table, kind discriminator), leaders, activity_types,
  coh_history. RLS is enabled on every table with placeholder policies that allow
  anonymous reads — Phase 4 tightens them.
- **Seed script** (`scripts/seed.ts`) that reads the prototype's `data/advancement.json`
  and populates Supabase end-to-end. Idempotent (truncates then inserts).
- **Supabase clients** (`src/lib/supabase/server.ts` + `client.ts`) using `@supabase/ssr`.
- **One feature end-to-end**: `/merit-badges` (catalog) and `/merit-badges/[mbId]`
  (drill-in with scout × leaf-requirement grid + requirement list). Server
  Components query Supabase directly, no client-side waterfall.

## What's NOT built yet

Everything else from the prototype: Home/news, Calendar, Meeting, Advancement
roster, per-scout Clipboard, the entire Leader Workspace (Fast Entry picker,
Event Roster, Universal Ledger, Court of Honor, Scoutbook Export, Lookups &
Admin), Meeting Editor, and Auth.

The foundation is intentionally generic so any of these can be added without
touching the database layer.

---

## Local development

### 1. Install (already done)

```bash
npm install
```

### 2. Start local Supabase

Requires Docker Desktop running.

```bash
npm run supabase:start
```

This boots a local Supabase stack in Docker (Postgres, PostgREST, Auth, Storage,
Studio) and prints credentials. Copy the **API URL**, **anon key**, and
**service_role key** into `.env.local` (see `.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

The schema migration is applied automatically on `supabase:start` and on
`supabase:reset`. The local DB is wiped on `supabase:stop` unless you preserve
volumes.

Supabase Studio (DB browser, table editor, auth users) is at
<http://127.0.0.1:54323>.

### 3. Seed from the prototype data

```bash
npm run seed
```

This reads `../data/advancement.json` and populates the tables.

### 4. Run the Next.js dev server

```bash
npm run dev
```

Open <http://localhost:3000/merit-badges>.

---

## Going to cloud

When you're ready to deploy:

### 1. Create a free Supabase project

Sign up at <https://supabase.com>, create a project, grab the API URL + anon key
+ service_role key from **Project Settings → API**.

### 2. Push the schema

From this directory:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

This applies the same migration SQL to the cloud project. Then:

```bash
SUPABASE_SERVICE_ROLE_KEY=<cloud-service-role> \
NEXT_PUBLIC_SUPABASE_URL=<cloud-url> \
npm run seed
```

### 3. Deploy to Vercel

Push this directory to a git repo, connect it to a new Vercel project (separate
from the OMG project), and set the three env vars in **Vercel → Settings →
Environment Variables**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (Production only — never expose)

Vercel auto-detects Next.js and builds on push.

---

## Architecture notes

- **Single `ledger_entries` table** with `kind` enum discriminator. Soft-delete
  + archive columns on the same row. Indexed for the `WHERE archived_at IS NULL
  AND deleted_at IS NULL` filter that nearly every read uses.
- **Recursive requirements**: `rank_requirements.parent_id` / `merit_badge_requirements.parent_id`
  are self-referential. Top-level rows have `parent_id = null`. `complete_rule`
  + `complete_n` encode optionality (`all` / `any` / `n-of`).
- **`mb_progress` view** aggregates per-scout-per-MB completion state so the
  catalog page can compute counts without loading the full ledger.
- **Scouts share one auth account with their parents**; leaders are a separate
  role (Phase 4). `scouts.auth_user_id` is the FK to `auth.users`.
- **Server Components first**: every page in this folder is a Server Component
  by default. Client Components are opt-in (`'use client'` directive) for
  interactivity. The Supabase server client respects the request cookie so RLS
  sees the right user.

## Where the prototype lives

The static prototype is at the repo root (`../index.html`, `../admin/…`).
Serve it with `python -m http.server 8000` from the repo root for the design
reference. The Next.js app and the static prototype can run side-by-side on
different ports.
