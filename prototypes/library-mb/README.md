# Prototype — Merit badge page, lower sections consolidated (rev 3)

**What it shows.** `/library/mb/[mbId]` (Chemistry) with today's three lower sections — Requirements tree, Whole-badge resources, "I did this" picker — folded into ONE quiet requirements list. Header, stats, and the Scout Progress grid are unchanged (except the header rule, now one continuous line). A row at rest is: code · label · a small dated **Done · Jun 12** or **Pending** pill for the viewer's own scouts · up to three icons at the right edge, in this order:

1. **View resources (count)** — only when the requirement has any; it (or the requirement text) opens the row to show one line per resource (pinned first with a ★, YouTube as a static thumbnail that links out) and the counselor note.
2. **I did this** — only while at least one of your scouts still needs the requirement; gone once every own scout is done or pending. Visitors never see it.
3. **Suggest a resource** — always, every viewer.

Whole-badge resources are the first row of the same list ("For the whole badge", ghost `MB` tag). A one-line legend at the top names the three icons and when they appear.

**Whose progress.** A household with two or more scouts gets the production "Showing progress for" pull-down (the `/library` ScoutSwitcher) directly under the Scout Progress grid; the rows personalise to that one scout — pill, I-did-this icon, and the proof dialog's pre-selected scout. The choice is remembered for the session (production: `?viewScout=`). One scout: plain text, no pull-down. The grid always shows every household scout.

**How to view.** Open `index.html` in a browser — one self-contained file, no build, no network. Resize to 375 px (or use device emulation) for the phone layout.

**Try first.**
1. The yellow bar at the top is prototype-only: switch between **Ari D. (scout)**, the **Dunmore household** (two scouts), and **Visitor**; watch the pills and which rows carry the I-did-this icon (none for visitors).
2. As the household, use **Showing progress for** under the grid to flip from Ari to Leo: the Done pills, the I-did-this icons and the group fractions all change to Leo's.
3. Click the text of **4c** (or its View resources icon, showing 4 as the household): three resources incl. a pinned YouTube thumbnail, plus a "sent for review" line only this viewer can see. Switch to the scout: the count drops to 3 and the line is gone.
4. Hover or Tab to any icon for its tooltip. With Leo selected, click **I did this** on **1d**: Leo is pre-selected (Ari shows "signed off Apr 19"), submit with nothing filled in for the error, then send a written report → a **Pending** pill appears and the icon disappears from that row.
5. Click **Suggest a resource** on **6** (a row with nothing attached), send one → the row gains a View resources icon and opens to show the pending line, for this viewer only.
6. **Collapse all / Expand all** at the Requirements divider (both the groups and every row's resources); then the **Handoff notes** at the bottom for the schema mapping, the per-requirement attachment plan, and the open questions.

**Everything is mocked.** Invented scouts, household, counselor, resources and dates; in-page JS only; "Reset demo data" restores the seed.
