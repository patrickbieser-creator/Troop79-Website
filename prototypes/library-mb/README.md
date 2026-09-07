# Prototype — Merit badge page, lower sections consolidated

**What it shows.** `/library/mb/[mbId]` (Chemistry) with today's three lower sections — Requirements tree, Whole-badge resources, "I did this" picker — folded into ONE requirements list. Header, stats, and the Scout Progress grid are unchanged. Each requirement row carries: code · label · completion chips for the viewer's own scouts · one quiet line per attached resource (pinned first, YouTube as a static thumbnail that links out) · a counselor note when one exists · two small text actions: **I did this** (proof dialog for that requirement) and **Suggest a resource** (pre-targeted suggestion dialog → "Sent for review"). Whole-badge resources are the first row of the same list ("For the whole badge", ghost `MB` tag).

**How to view.** Open `index.html` in a browser — one self-contained file, no build, no network. Resize to 375 px (or use device emulation) for the phone layout.

**Try first.**
1. The yellow bar at the top is prototype-only: switch between **Ari D. (scout)**, the **Dunmore household** (two scouts), and **Visitor** and watch the chips, the "I did this" buttons, and the pending line on **4c** change.
2. As the household, scroll to **4c** — three resources incl. a pinned YouTube thumbnail and a "Sent for review" line only that viewer can see. Switch to the scout: the line disappears.
3. Click **I did this** on **1d** as the household: Leo is pre-selected (Ari is already signed off), pick a proof type, submit with nothing filled in to see the error, then send one → the row shows ⏳ next to LD and the button greys.
4. Click **Suggest a resource** on **6** (a row with nothing attached), send one → a dashed pending line appears under 6 for this viewer.
5. **Collapse all** at the Requirements divider; open the **Handoff notes** at the bottom for the schema mapping, the per-requirement attachment plan, and the open questions.

**Everything is mocked.** Invented scouts, household, counselor, and resources; in-page JS only; "Reset demo data" restores the seed.
