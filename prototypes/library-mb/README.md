# Prototype — Merit badge page, lower sections consolidated (rev 2)

**What it shows.** `/library/mb/[mbId]` (Chemistry) with today's three lower sections — Requirements tree, Whole-badge resources, "I did this" picker — folded into ONE quiet requirements list. Header, stats, and the Scout Progress grid are unchanged (except the header rule, now one continuous line). A row at rest is: code · label · a small dated **Done · Jun 12** or **Pending** pill for the viewer's own scouts · three icons at the right edge: **I did this** · **Resources** with a count (only when there are any) · **Add a resource**. Clicking the requirement text or the Resources icon opens the row to reveal one line per resource (pinned first with a ★, YouTube as a static thumbnail that links out) and the counselor note. Whole-badge resources are the first row of the same list ("For the whole badge", ghost `MB` tag). A one-line legend at the top names the three icons.

**How to view.** Open `index.html` in a browser — one self-contained file, no build, no network. Resize to 375 px (or use device emulation) for the phone layout.

**Try first.**
1. The yellow bar at the top is prototype-only: switch between **Ari D. (scout)**, the **Dunmore household** (two scouts), and **Visitor**; watch the pills and the I-did-this icon change (visitors get neither).
2. Click the text of **4c** (or its Resources icon, showing 4 as the household): three resources incl. a pinned YouTube thumbnail, plus a "sent for review" line only this viewer can see. Switch to the scout: the count drops to 3 and the line is gone.
3. Hover or Tab to any icon for its tooltip. Click **I did this** on **1d** as the household: Leo is pre-selected (Ari shows "signed off Apr 19"), submit with nothing filled in for the error, then send a written report → a **LD · Pending** pill appears and the icon greys.
4. Click **Add a resource** on **6** (a row with nothing attached), send one → the row gains a Resources icon and opens to show the pending line, for this viewer only.
5. **Collapse all / Expand all** at the Requirements divider (both the groups and every row's resources); then the **Handoff notes** at the bottom for the schema mapping, the per-requirement attachment plan, and the open questions.

**Everything is mocked.** Invented scouts, household, counselor, resources and dates; in-page JS only; "Reset demo data" restores the seed.
