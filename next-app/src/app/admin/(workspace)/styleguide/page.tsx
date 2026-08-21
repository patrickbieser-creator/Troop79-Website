/**
 * /admin/styleguide — the Leader Workspace pattern library and consistency
 * tracker (Plans/Admin-Design-System.md, 2026-08-21).
 *
 * Two jobs:
 *   1. REFERENCE — the canonical version of every recurring admin UI pattern
 *      (buttons, tabs, badges, tables, cards, Actions ▾ …), rendered from
 *      the REAL production CSS-module classes, imported from the screens
 *      that own them. Because the samples share the live stylesheets, this
 *      page cannot drift from what actually ships.
 *   2. TRACKER — beside each canonical sample, the divergent copies found by
 *      the 2026-08-21 audit render side-by-side ("variants in the wild"), so
 *      inconsistencies stay visible until remediation retires them. As the
 *      phased plan replaces copies with shared components, variant cells
 *      here get deleted — an empty variants row means the pattern is done.
 *
 * No page-level capability guard, deliberately: the workspace layout already
 * requires a resolved admin actor, and this page reads no data and performs
 * no writes — it renders static samples only. The nav offers it to full
 * admins (capability-less item semantics in sub-nav.tsx).
 */
import sg from './styleguide.module.css';
import { DialogDemo } from './dialog-demo';
import cal from '../calendar/calendar.module.css';
import wb from '../calendar/[id]/workbench.module.css';
import rollCall from '../calendar/[id]/roll-call/roll-call.module.css';
import ledger from '../advancement/ledger/ledger.module.css';
import roster from '../advancement/roster/roster.module.css';
import imp from '../advancement/roster-import/roster-import.module.css';
import meet from '../advancement/meetings/meetings.module.css';
import coh from '../advancement/court-of-honor/court-of-honor.module.css';
import plan from '../advancement/meeting-plan/meeting-plan.module.css';
import lookups from '../advancement/lookups/lookups.module.css';
import art from '../news/articles/articles.module.css';
import albums from '../news/photo-albums/albums.module.css';
import ev from '../events/events-admin.module.css';
import fin from '../finance/finance.module.css';
import util from '../utilities/utilities.module.css';
import lib from '../library/library.module.css';

export const metadata = {
  title: 'Styleguide — Troop 79'
};

/* ── Token data (mirrors admin.css — names only; swatches read the live
      var() so a value change there updates here automatically) ── */
const BRAND_TOKENS = [
  ['--admin-navy', '#1e3a4a', false],
  ['--admin-navy-light', '#2a5068', false],
  ['--admin-navy-hover', '#163040', false],
  ['--admin-forest', '#3d7a4a', false],
  ['--admin-forest-dark', '#2e6038', false],
  ['--admin-danger', '#c0392b', false],
  ['--admin-danger-hover', '#a93226', false],
  ['--admin-danger-dark', '#8c2f2f', true],
  ['--admin-warning', '#d4a017', false],
  ['--admin-accent-gold', '#8b6914', true],
  ['--admin-bg', '#f5f6f8', false],
  ['--admin-white', '#ffffff', false]
] as const;

const GRAY_TOKENS = [
  ['--admin-gray-50', '#fafbfc', false],
  ['--admin-gray-100', '#f0f1f3', false],
  ['--admin-gray-200', '#e2e4e8', false],
  ['--admin-gray-300', '#cdd1d6', false],
  ['--admin-gray-400', '#9ba1aa', false],
  ['--admin-gray-500', '#6d7580', false],
  ['--admin-gray-600', '#666666', true],
  ['--admin-gray-700', '#3a3f47', false],
  ['--admin-gray-800', '#2a2e34', true],
  ['--admin-gray-900', '#1a1d21', false]
] as const;

const STATUS_TOKENS = [
  ['--admin-status-error-bg', '#fdf0ef', true],
  ['--admin-status-warning-bg', '#fdf3d6', true],
  ['--admin-status-success-bg', '#f0f6f1', true],
  ['--admin-status-info-bg', '#eef3f8', true]
] as const;

const TYPE_SCALE = [
  ['--admin-text-2xs', '9px'],
  ['--admin-text-xs', '10px'],
  ['--admin-text-sm', '11px'],
  ['--admin-text-base', '12px'],
  ['--admin-text-md', '13px'],
  ['--admin-text-lg', '14px'],
  ['--admin-text-xl', '16px'],
  ['--admin-text-2xl', '20px'],
  ['--admin-text-3xl', '24px'],
  ['--admin-text-4xl', '32px']
] as const;

const SPACE_SCALE = [
  ['--admin-space-1', 2], ['--admin-space-2', 4], ['--admin-space-3', 6],
  ['--admin-space-4', 8], ['--admin-space-5', 10], ['--admin-space-6', 12],
  ['--admin-space-7', 14], ['--admin-space-8', 16], ['--admin-space-9', 18],
  ['--admin-space-10', 20], ['--admin-space-11', 24], ['--admin-space-12', 28],
  ['--admin-space-13', 32], ['--admin-space-14', 40]
] as const;

const SCOREBOARD: {
  pattern: string;
  copies: string;
  canonical: string;
  phase: string;
  notes: string;
}[] = [
  {
    pattern: 'Add buttons (green "+ Add X")',
    copies: '6 files + 1 rename (.seedBtn)',
    canonical: 'calendar/articles/meetings/albums .addBtn (4-way identical)',
    phase: 'A',
    notes: 'lookups pads 6×12 not 7×14; roster is navy/5px-radius — a design call, not drift'
  },
  {
    pattern: 'Primary buttons',
    copies: '4 files, 3 designs, 2 naming families',
    canonical: 'court-of-honor/report .primaryBtn (identical pair)',
    phase: 'A',
    notes: 'workbench repaints via PUBLIC --forest token; library has its own .btnPrimary family shared with public pages'
  },
  {
    pattern: 'Danger buttons',
    copies: '7+ files, outlined AND solid treatments',
    canonical: 'decide: outlined (albums et al.) vs solid (events-admin)',
    phase: 'A',
    notes: 'roster + access use hardcoded reds off-token entirely'
  },
  {
    pattern: 'Pill tab strips + count badges',
    copies: '4 byte-identical copies',
    canonical: 'calendar .tabs/.tab/.tabOn/.tabCount',
    phase: 'A',
    notes: 'only drift is the modifier name: .tabOn (calendar/articles) vs .tabActive (roster ×2)'
  },
  {
    pattern: 'Non-pill tab variants',
    copies: '4 distinct designs (meeting-plan, library, media-picker, court-of-honor .viewTabs)',
    canonical: 'design decision needed — different visual language, not drift',
    phase: 'B',
    notes: 'media-picker styles its tabs with PUBLIC tokens'
  },
  {
    pattern: 'Badges / status pills',
    copies: '9+ files, 4 naming families, 2 radii (10px vs 999px)',
    canonical: 'meetings .statusPill base, generalized to pill radius',
    phase: 'A',
    notes: '.badge / .statusPill / .pill / .tag all mean the same thing'
  },
  {
    pattern: 'Actions ▾ menu',
    copies: '7 identical + 3 divergent (roster, calendar, roster-import)',
    canonical: 'finance .select (D-156 original)',
    phase: 'A',
    notes: "roster's is shorter + darker; calendar reuses .filterSelect"
  },
  {
    pattern: 'Data tables',
    copies: '15 files: compact cluster (5), wrapped-card cluster (4), outliers',
    canonical: 'both clusters legitimate — normalize within each',
    phase: 'B',
    notes: 'meeting-plan navy header + access rem units are deliberate one-offs to confirm; .numCell exists in ledger/finance while 23 inline sites hand-roll text-align:right'
  },
  {
    pattern: 'Cards / panels',
    copies: '14 files .card + 4 files .panel',
    canonical: 'utilities/lookups/dashboard/fast-entry .card (identical)',
    phase: 'B',
    notes: "roster-import's .card is an interactive disclosure — different thing sharing the name"
  },
  {
    pattern: '<dialog> modals',
    copies: '4 legacy copies; only calendar has the margin:auto/max-height centering fix',
    canonical: 'the APPROVED spec in the Dialogs section (2026-08-21) — extract as the shared Dialog component',
    phase: 'A (bug)',
    notes: 'media-picker uses a custom div overlay instead — unify later, HIGH risk. New dialogs copy the approved spec, not calendar’s legacy .dialog.'
  },
  {
    pattern: 'Page titles',
    copies: '26 of 35 files',
    canonical: 'shared verbatim block (border-bottom 1px, 14px pad)',
    phase: 'B',
    notes: 'access.module.css is the lone rem-units outlier'
  },
  {
    pattern: 'Error / success notices',
    copies: '4 names for one concept (.rowError/.editError/.fieldError/.notice)',
    canonical: 'one Notice component on the status-bg tokens',
    phase: 'B',
    notes: '11-file pale-red tint cluster collapses into --admin-status-error-bg'
  },
  {
    pattern: 'Inline styles',
    copies: '174 sites; 162 convertible, 12 legitimately dynamic',
    canonical: 'module classes + the token scales',
    phase: 'C',
    notes: 'top offender: bare text-align:right ×23; login and rosters pages have no stylesheet at all'
  },
  {
    pattern: 'Eyebrow labels (11px/700/uppercase)',
    copies: '32 of 35 files re-declare it',
    canonical: 'planned .adminLabel utility (Phase A)',
    phase: 'A',
    notes: 'the single most universal idiom in the workspace'
  }
];

function Swatch({ name, value, isNew }: { name: string; value: string; isNew: boolean }) {
  return (
    <div className={sg.swatch}>
      <div className={sg.swatchColor} style={{ background: `var(${name})` }} />
      <div className={sg.swatchMeta}>
        <span className={sg.swatchName}>
          {name}
          {isNew && <span className={sg.swatchNew}>New</span>}
        </span>
        <span className={sg.swatchValue}>{value}</span>
      </div>
    </div>
  );
}

function Specimen({
  label,
  canonical,
  note,
  children
}: {
  label: string;
  canonical?: boolean;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${sg.specimen} ${canonical ? sg.specimenCanonical : ''}`}>
      <div className={sg.specimenLabel}>{canonical ? `✓ Canonical — ${label}` : label}</div>
      <div className={sg.specimenBody}>{children}</div>
      <div className={sg.specimenNote}>{note}</div>
    </div>
  );
}

export default function StyleguidePage() {
  return (
    <>
      <div className={sg.pageTitle}>
        <h1>Admin Styleguide</h1>
        <p>
          The canonical version of every recurring Leader Workspace pattern, rendered from the
          live production stylesheets — plus the divergent copies still in the wild, side by
          side, until remediation retires them. Before styling a new screen, find the pattern
          here and import it; if you&rsquo;re about to write a class that looks like one of
          these, stop. Plan: <code>Plans/Admin-Design-System.md</code>.
        </p>
      </div>

      {/* ════ TOKENS ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Color Tokens</h2>
        <p className={sg.sectionNote}>
          Defined on <code>:root</code> in <code>admin.css</code> — the single source of truth.
          Swatches read the live <code>var()</code>, so a value change there updates this page
          automatically. &ldquo;New&rdquo; marks tokens added by the 2026-08-21 audit.
        </p>
        <div className={sg.swatchGrid}>
          {BRAND_TOKENS.map(([n, v, isNew]) => (
            <Swatch key={n} name={n} value={v} isNew={isNew} />
          ))}
        </div>
        <div className={sg.swatchGrid}>
          {GRAY_TOKENS.map(([n, v, isNew]) => (
            <Swatch key={n} name={n} value={v} isNew={isNew} />
          ))}
        </div>
        <div className={sg.swatchGrid}>
          {STATUS_TOKENS.map(([n, v, isNew]) => (
            <Swatch key={n} name={n} value={v} isNew={isNew} />
          ))}
        </div>
      </section>

      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Type Scale</h2>
        <p className={sg.sectionNote}>
          Half-pixel sizes in the wild (10.5/11.5/12.5/13.5px — ~162 uses) are drift; they
          round to the nearest step during remediation. Weights: 400 / 600 / 700. Tracking:
          .02–.12em in five steps.
        </p>
        {TYPE_SCALE.map(([n, v]) => (
          <div key={n} className={sg.scaleRow}>
            <span className={sg.scaleName}>
              {n} · {v}
            </span>
            <span style={{ fontSize: `var(${n})` }}>Scouts BSA Troop 79 — Milwaukee, WI</span>
          </div>
        ))}
      </section>

      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Spacing Scale</h2>
        <p className={sg.sectionNote}>
          Derived from the audit&rsquo;s 1,553-declaration histogram. Odd values (3/5/7/9/11px)
          fold into the nearest step during remediation.
        </p>
        {SPACE_SCALE.map(([n, px]) => (
          <div key={n} className={sg.scaleRow}>
            <span className={sg.scaleName}>
              {n} · {px}px
            </span>
            <span className={sg.spaceBar} style={{ width: px * 4 }} />
          </div>
        ))}
      </section>

      {/* ════ BUTTONS ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Buttons</h2>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Add button"
            canonical
            note="calendar/articles/meetings/albums .addBtn — 4 byte-identical copies today; becomes one shared component in Phase A."
          >
            <button type="button" className={cal.addBtn}>+ Add Event</button>
          </Specimen>
          <Specimen
            label="Add variants in the wild"
            note="lookups pads 6×12 instead of 7×14; roster went navy with a 5px radius (design call needed); roll-call hides an identical clone under .seedBtn."
          >
            <button type="button" className={lookups.addBtn}>+ Add</button>
            <button type="button" className={roster.addBtn}>+ Add Scout</button>
            <button type="button" className={rollCall.seedBtn}>Seed from Signups</button>
          </Specimen>
          <Specimen
            label="Row actions"
            canonical
            note="ledger .actionBtn / .actionBtnDanger — identical in articles; the quiet per-row Edit/Void/Delete idiom."
          >
            <button type="button" className={ledger.actionBtn}>Edit</button>
            <button type="button" className={`${ledger.actionBtn} ${ledger.actionBtnDanger}`}>Void</button>
          </Specimen>
          <Specimen
            label="Primary — 3 designs"
            note="court-of-honor (navy 9×18) vs workbench (repainted via the PUBLIC --forest token) vs roster-import (8×16). No canonical yet — Phase A decision."
          >
            <button type="button" className={coh.primaryBtn}>Publish</button>
            <button type="button" className={`${wb.btn} ${wb.primaryBtn}`}>Save</button>
            <button type="button" className={imp.primaryBtn}>Import</button>
          </Specimen>
          <Specimen
            label="Danger — outlined vs solid vs off-token"
            note="albums et al. outline in danger red; events-admin fills solid (#a04a3d); roster hardcodes #8c2f2f off-token. One treatment should win in Phase A."
          >
            <button type="button" className={`${albums.editBtn} ${albums.dangerBtn}`}>Delete</button>
            <button type="button" className={ev.dangerBtn}>Remove</button>
            <button type="button" className={roster.dangerBtn}>Deactivate</button>
          </Specimen>
          <Specimen
            label="Library's own family"
            note="library .btnPrimary/.btnSecondary — a 4th naming convention, and this stylesheet is shared with 20 PUBLIC routes: never restyle it from the admin side."
          >
            <button type="button" className={lib.btnPrimary}>Approve</button>
            <button type="button" className={lib.btnSecondary}>Decline</button>
          </Specimen>
        </div>
      </section>

      {/* ════ TABS ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Tab Strips</h2>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Pill tabs + count badge"
            canonical
            note="calendar .tabs/.tab/.tabOn/.tabCount — byte-identical in articles, roster, roster-import (those two renamed the active modifier .tabActive; the shared component normalizes it)."
          >
            <div className={cal.tabs}>
              <button type="button" className={`${cal.tab} ${cal.tabOn}`}>
                Upcoming <span className={cal.tabCount}>12</span>
              </button>
              <button type="button" className={cal.tab}>
                Past <span className={cal.tabCount}>48</span>
              </button>
            </div>
          </Specimen>
          <Specimen
            label="Underline tabs (meeting-plan)"
            note="A different visual language, not drift — folding it into the pill component is a Phase B design decision."
          >
            <div className={plan.tabs}>
              <button type="button" className={`${plan.tabBtn} ${plan.tabBtnActive}`}>Sessions</button>
              <button type="button" className={plan.tabBtn}>Roster</button>
            </div>
          </Specimen>
          <Specimen
            label="Workstation tabs (library)"
            note="library .tab/.tabOn/.tabBadge — shared with public pages; needs its own scoped pass (backlog item from D-160)."
          >
            <div className={lib.tabs}>
              <button type="button" className={`${lib.tab} ${lib.tabOn}`}>
                Queue <span className={lib.tabBadge}>3</span>
              </button>
              <button type="button" className={lib.tab}>Shelf</button>
            </div>
          </Specimen>
          <Specimen
            label="View tabs (court-of-honor)"
            note="A 4th independent tab idiom found by the audit — .viewTabs/.viewTab/.viewTabActive."
          >
            <div className={coh.viewTabs}>
              <button type="button" className={`${coh.viewTab} ${coh.viewTabActive}`}>Preview</button>
              <button type="button" className={coh.viewTab}>Markdown</button>
            </div>
          </Specimen>
        </div>
      </section>

      {/* ════ BADGES ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Badges &amp; Status Pills</h2>
        <p className={sg.sectionNote}>
          Four naming families (.badge / .statusPill / .pill / .tag), two radius conventions
          (10px vs 999px), three paddings — all meaning &ldquo;small colored status
          label.&rdquo; Phase A collapses them into one Badge component.
        </p>
        <div className={sg.specimenGrid}>
          <Specimen
            label="meetings .statusPill"
            canonical
            note="Cleanest base + semantic modifiers; canonical shape, generalized to pill radius."
          >
            <span className={`${meet.statusPill} ${meet.statusDraft}`}>Draft</span>
            <span className={`${meet.statusPill} ${meet.statusPublished}`}>Published</span>
          </Specimen>
          <Specimen label="roster .badge (10px radius)" note="Ok/Warn/Bad traffic-light semantics.">
            <span className={`${roster.badge} ${roster.badgeOk}`}>Active</span>
            <span className={`${roster.badge} ${roster.badgeWarn}`}>Check</span>
            <span className={`${roster.badge} ${roster.badgeBad}`}>Missing</span>
          </Specimen>
          <Specimen
            label="calendar .statusPill (999px radius)"
            note="Same name as meetings' pill, different radius and padding."
          >
            <span className={`${cal.statusPill} ${cal.statusDraft}`}>Draft</span>
            <span className={`${cal.statusPill} ${cal.statusClosed}`}>Closed</span>
          </Specimen>
          <Specimen
            label="roster-import .badge (2px, bordered)"
            note="Structurally different treatment wearing the same .badge name."
          >
            <span className={`${imp.badge} ${imp.badgeWeak}`}>Weak match</span>
            <span className={`${imp.badge} ${imp.badgeConflict}`}>Conflict</span>
          </Specimen>
          <Specimen label="articles .pill / roll-call .pill" note="A third and fourth family name.">
            <span className={`${art.pill} ${art.pillPublished}`}>Published</span>
            <span className={`${art.pill} ${art.pillDraft}`}>Draft</span>
            <span className={rollCall.pill}>4 nights</span>
          </Specimen>
          <Specimen label="roster .tagActive / court-of-honor .badgeDraft" note="…and a fifth and sixth.">
            <span className={roster.tagActive}>Active</span>
            <span className={roster.tagInactive}>Inactive</span>
            <span className={coh.badgeDraft}>Draft</span>
          </Specimen>
        </div>
      </section>

      {/* ════ ACTIONS ▾ ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Actions ▾ Menu</h2>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Actions ▾ select"
            canonical
            note="finance .select (D-156 original) — pasted verbatim into 6 more screens in v1.54.0. Becomes one ActionsMenu component in Phase A."
          >
            <select className={fin.select} defaultValue="" aria-label="Sample actions">
              <option value="">Actions…</option>
              <option value="x">Record a transaction</option>
            </select>
          </Specimen>
          <Specimen
            label="Divergent copies"
            note="roster reused its older .select (shorter, darker, no focus ring); calendar reused .filterSelect from its filter row. Visibly different from the other 7 screens."
          >
            <select className={roster.select} defaultValue="" aria-label="Roster actions sample">
              <option value="">Actions…</option>
            </select>
            <select className={cal.filterSelect} defaultValue="" aria-label="Calendar actions sample">
              <option value="">Actions…</option>
            </select>
          </Specimen>
        </div>
      </section>

      {/* ════ TABLES ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Data Tables</h2>
        <p className={sg.sectionNote}>
          Two legitimate clusters (compact, wrapped-card) plus outliers. Note{' '}
          <code>.numCell</code> already exists in ledger and finance for right-aligned numeric
          cells — while 23 inline <code>textAlign</code> hacks re-invent it elsewhere.
        </p>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Compact cluster"
            canonical
            note="calendar/albums/scoutbook-export/roster/meetings — 12.5px, tight padding, uppercase gray headers."
          >
            <table className={cal.table}>
              <thead>
                <tr><th>Event</th><th>Date</th></tr>
              </thead>
              <tbody>
                <tr><td>Court of Honor</td><td>Sep 14</td></tr>
                <tr><td>Fall Campout</td><td>Oct 3–5</td></tr>
              </tbody>
            </table>
          </Specimen>
          <Specimen
            label="Wrapped-card cluster"
            canonical
            note="articles/finance/ledger/records — .tableWrap card container, roomier padding, 2px header rule. Numeric cells use .numCell."
          >
            <div className={ledger.tableWrap}>
              <table className={ledger.table}>
                <thead>
                  <tr><th>Activity</th><th className={ledger.numCell}>Amount</th></tr>
                </thead>
                <tbody>
                  <tr><td>Summer Camp</td><td className={ledger.numCell}>$425.00</td></tr>
                  <tr><td>Wreath Sale</td><td className={ledger.numCell}>$118.50</td></tr>
                </tbody>
              </table>
            </div>
          </Specimen>
          <Specimen
            label="Navy-header outlier"
            note="meeting-plan inverts the header — the only navy table header in the workspace. Confirm intent before normalizing."
          >
            <table className={plan.table}>
              <thead>
                <tr><th>Session</th><th>Teacher</th></tr>
              </thead>
              <tbody>
                <tr><td>Totin&rsquo; Chip</td><td>MST</td></tr>
              </tbody>
            </table>
          </Specimen>
        </div>
      </section>

      {/* ════ CARDS ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Cards &amp; Panels</h2>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Card"
            canonical
            note="utilities/lookups/dashboard/fast-entry — identical (fast-entry pads 18px). court-of-honor + report share a second, shadow-less shape."
          >
            <div className={util.card} style={{ width: '100%' }}>
              <div className={util.cardSoon}>Card content</div>
            </div>
          </Specimen>
          <Specimen
            label="Panel family"
            note="events-admin/meetings .panel (5px radius) vs workbench .panel (4px) — same concept as .card under another name."
          >
            <div className={ev.panel} style={{ width: '100%' }}>
              <div className={ev.panelHead}>Panel heading</div>
              Panel content
            </div>
          </Specimen>
        </div>
      </section>

      {/* ════ NOTICES ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Notices &amp; Errors</h2>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Four names, one concept"
            note=".rowError (articles/lookups), .editError (calendar), .fieldError (finance), .notice (roster-import, success). The pale-tint backgrounds behind these span an 11-file drift cluster now collapsed into the status-bg tokens."
          >
            <div style={{ display: 'grid', gap: 8, width: '100%' }}>
              <p className={art.rowError}>Something went wrong saving this row.</p>
              <p className={cal.editError}>That date isn&rsquo;t valid.</p>
              <p className={fin.fieldError}>Amount is required.</p>
              <p className={imp.notice}>Import complete — 3 people added.</p>
            </div>
          </Specimen>
        </div>
      </section>

      {/* ════ DIALOG ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Dialogs</h2>
        <p className={sg.sectionNote}>
          The spec below was <strong>approved 2026-08-21</strong> and is what every admin
          dialog converges on: shadow-lg elevation, 8px radius, navy-tinted blurred backdrop,
          entry motion, banded header/footer zones, and a danger variant so destructive
          confirmations stop looking like edits. Backdrop and motion only show on the live
          demo. Phase A extracts it as the shared Dialog component; new dialogs built before
          then copy this spec, not the legacy one. Legacy state: native{' '}
          <code>&lt;dialog&gt;</code> in calendar/meetings/albums/media-manager, where only
          calendar&rsquo;s copy carries the <code>margin:auto</code> /{' '}
          <code>max-height:88vh</code> centering-and-scroll fix (the other three likely
          mis-center tall content); media-picker uses a custom div overlay — a different
          mechanism entirely, unified last (high risk).
        </p>
        <div className={sg.dialogCompare}>
          <div>
            <div className={`${sg.specimenLabel} ${sg.specimenLabelApproved}`}>
              ✓ Approved spec (2026-08-21)
            </div>
            <div className={`${sg.dialogSpec} ${sg.dialogStatic}`}>
              <div className={sg.dialogSpecHeader}>
                <h3 className={sg.dialogSpecTitle}>Edit calendar entry</h3>
                <p className={sg.dialogSpecSub}>Changes apply immediately when saved.</p>
              </div>
              <div className={sg.dialogSpecBody}>Body content…</div>
              <div className={sg.dialogSpecActions}>
                <button type="button" className={sg.ghostBtn}>Cancel</button>
                <button type="button" className={sg.demoBtn}>Save</button>
              </div>
            </div>
          </div>
          <div>
            <div className={`${sg.specimenLabel} ${sg.specimenLabelApproved}`}>
              ✓ Approved spec — danger variant
            </div>
            <div className={`${sg.dialogSpec} ${sg.dialogSpecDanger} ${sg.dialogStatic}`}>
              <div className={sg.dialogSpecHeader}>
                <h3 className={sg.dialogSpecTitle}>Delete this entry?</h3>
                <p className={sg.dialogSpecSub}>
                  Signups and roll call for it will be removed. This can&rsquo;t be undone.
                </p>
              </div>
              <div className={sg.dialogSpecBody}>Body content…</div>
              <div className={sg.dialogSpecActions}>
                <button type="button" className={sg.ghostBtn}>Cancel</button>
                <button type="button" className={sg.demoBtn}>Delete</button>
              </div>
            </div>
          </div>
          <DialogDemo />
          <div>
            <div className={sg.specimenLabel}>
              Legacy — calendar .dialog (to convert in Phase A)
            </div>
            <div className={`${cal.dialog} ${sg.dialogStatic}`}>
              <div className={cal.dialogInner}>
                <div className={cal.dialogHeader}>
                  <h3>Edit calendar entry</h3>
                  <p>Changes apply immediately when saved.</p>
                </div>
                Body content…
                <div className={cal.dialogActions}>
                  <button type="button" className={cal.editSaveBtn}>Save</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════ SCOREBOARD ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Inconsistency Scoreboard</h2>
        <p className={sg.sectionNote}>
          The 2026-08-21 audit, condensed. Full detail and phase definitions:{' '}
          <code>Plans/Admin-Design-System.md</code>. When a row&rsquo;s copies are consolidated,
          delete its variant specimens above and strike the row.
        </p>
        <table className={sg.scoreTable}>
          <thead>
            <tr>
              <th>Pattern</th>
              <th>Copies in the wild</th>
              <th>Canonical</th>
              <th>Phase</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {SCOREBOARD.map((row) => (
              <tr key={row.pattern}>
                <td><strong>{row.pattern}</strong></td>
                <td><span className={sg.countPill}>{row.copies}</span></td>
                <td>{row.canonical}</td>
                <td>{row.phase}</td>
                <td>{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ════ RULES ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Rules</h2>
        <div className={sg.rules}>
          The token sheet (<code>admin.css</code>) is the single source of truth. From
          2026-08-21 on:
          <ul>
            <li>
              <strong>No raw hex in admin CSS.</strong> Use a token; if none fits, add one to
              admin.css with a comment — never inline.
            </li>
            <li>
              <strong>Never read public tokens</strong> (<code>--navy</code>,{' '}
              <code>--forest</code>, <code>--bark</code>, <code>--transition</code>…) from
              admin styles. The audit found 5 files leaking the editorial palette; they are
              being remediated, not imitated.
            </li>
            <li>
              <strong>Spacing, font sizes, and radii come from the scales.</strong> An
              off-scale value is a design decision — comment it.
            </li>
            <li>
              <strong>Before writing a new class, check this page.</strong> If the pattern
              exists, import the canonical version (or the shared component once Phase A
              lands). New inline <code>style=&#123;&#123;…&#125;&#125;</code> is reserved for
              genuinely dynamic values.
            </li>
            <li>
              <strong>This page ships with the change that affects it.</strong> A new admin
              pattern, class family, token, or shared component gets its specimen (and a
              scoreboard row if it has variants) added here in the same commit; retiring a
              variant deletes its specimen and strikes its row. A styleguide that lags the
              code is the drift problem wearing a nicer name.
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
