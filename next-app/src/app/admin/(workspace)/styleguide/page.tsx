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
import { ActionsMenuSpecimen } from './specimens';
import { TabStrip } from '../_components/tab-strip';
import { AddButton } from '../_components/add-button';
import { Badge } from '../_components/badge';
import dlg from '../_components/dialog.module.css';
import cal from '../calendar/calendar.module.css';
import ledger from '../advancement/ledger/ledger.module.css';
import imp from '../advancement/roster-import/roster-import.module.css';
import coh from '../advancement/court-of-honor/court-of-honor.module.css';
import plan from '../advancement/meeting-plan/meeting-plan.module.css';
import art from '../news/articles/articles.module.css';
import albums from '../news/photo-albums/albums.module.css';
import mm from '../news/media-manager/media-manager.module.css';
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
    copies: '✓ DONE — 0 copies left',
    canonical:
      '✓ SHIPPED: shared AddButton — calendar/articles/albums (v1.57.0), then lookups (7 editors), roster (navy one-off → green, Patrick 2026-08-21), and roll-call’s .seedBtn clone',
    phase: 'A',
    notes:
      'meetings/report’s green SUBMIT and lookups’ green Save were re-classed navy — submits are primaries, not Adds'
  },
  {
    pattern: 'Primary buttons',
    copies: '✓ DECIDED + APPLIED — navy (Patrick 2026-08-21)',
    canonical: 'court-of-honor/report .primaryBtn; green stays reserved for Add/create',
    phase: 'A',
    notes:
      'workbench’s forest Save (a public --forest leak) and the green submits converted to navy; library’s .btnPrimary family is shared with public pages and stays'
  },
  {
    pattern: 'Danger buttons',
    copies: '✓ DECIDED + APPLIED — both, with rules (Patrick 2026-08-21)',
    canonical:
      'outlined for in-context actions; SOLID reserved for the confirm inside a danger Dialog',
    phase: 'A',
    notes:
      'events-admin’s solid one-off → outlined; roster + access hardcoded reds re-tokened; all outlined copies now share the color-mix border + status-error-bg hover'
  },
  {
    pattern: 'Pill tab strips + count badges',
    copies: '✓ DONE — 0 copies left',
    canonical: '✓ SHIPPED: shared TabStrip (calendar, articles, roster ×2, roster-import converted 2026-08-21; per-screen copies deleted)',
    phase: 'A',
    notes: 'the .tabOn/.tabActive naming split is gone; strips also gained proper tablist roles where they were missing'
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
    copies: '✓ DONE — 0 status-pill copies left',
    canonical:
      '✓ SHIPPED: shared Badge (neutral/success/warning/danger/info/muted) — meetings, calendar, articles, article-editor, roster, roster-import, roll-call, court-of-honor, report converted 2026-08-21',
    phase: 'A',
    notes:
      'Deliberate exceptions: library workstation (stylesheet shared with 20 public routes, D-160) and CATEGORICAL tags (lookups rank/MB/Eagle, meeting-plan track tags, scoutbook-export type badges) — categories are not statuses'
  },
  {
    pattern: 'Actions ▾ menu',
    copies: '✓ DONE — 0 copies left',
    canonical: '✓ SHIPPED: shared ActionsMenu — all 8 screens converted 2026-08-21, 3 divergents retired, dead CSS deleted',
    phase: 'A',
    notes: "ledger's/articles' .select are filter selects (persistent values), correctly untouched; roster-import's is a batch picker, same"
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
    copies: '✓ DONE — 4 legacy copies (calendar, meetings, albums, media-manager ×2) converted 2026-08-21',
    canonical:
      '✓ SHIPPED: shared Dialog component (_components/dialog) implementing the approved spec — centering fix delivered to meetings/albums/media-manager',
    phase: 'A (bug)',
    notes:
      'Remaining families (ledger/roster/lookups editDialog etc.) adopt it in Phase B; media-picker’s custom div overlay unifies last, HIGH risk'
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
    canonical: '✓ SHIPPED: global .adminLabel utility in admin.css (2026-08-21)',
    phase: 'A',
    notes: 'utility exists; the 32 per-screen re-declarations retire screen-by-screen in Phases B/C'
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

      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Utilities</h2>
        <p className={sg.sectionNote}>
          Global classes in <code>admin.css</code> — usable from any admin markup without a
          module import.
        </p>
        <div className={sg.specimenGrid}>
          <Specimen
            label=".adminLabel — the eyebrow label"
            canonical
            note="SHIPPED Phase A (2026-08-21): the 11px/700/uppercase idiom re-declared in 32 of 35 module files. Typography only — consumers add display/margin themselves. Per-screen copies retire in Phases B/C."
          >
            <span className="adminLabel">Section heading</span>
          </Specimen>
        </div>
      </section>

      {/* ════ BUTTONS ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Buttons</h2>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Add button — shared AddButton component"
            canonical
            note="Phase A COMPLETE (2026-08-21): every green Add in the workspace renders this component — calendar, articles, albums, the 7 lookups editors, roster (converted from its navy one-off, Patrick's call), and roll-call's seed action. Import from _components/add-button; href renders a Link, onClick a button; disabled supported."
          >
            <AddButton>+ Add Event</AddButton>
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
            label="Primary — navy (decided 2026-08-21)"
            canonical
            note="Patrick's Phase A call: primaries are NAVY (court-of-honor/report .primaryBtn); green stays reserved for Add/create, so color carries meaning. Workbench's forest Save (a public-token leak) and the green form submits were converted."
          >
            <button type="button" className={coh.primaryBtn}>Publish</button>
          </Specimen>
          <Specimen
            label="Danger — both, with rules (decided 2026-08-21)"
            canonical
            note="Patrick's Phase A call: OUTLINED for in-context destructive actions (rows, panels) — quiet until hovered; SOLID reserved for the confirm button inside a danger Dialog. All copies now share the tokens (color-mix border, status-error-bg hover)."
          >
            <button type="button" className={`${albums.editBtn} ${albums.dangerBtn}`}>Delete</button>
            <button type="button" className={mm.deleteConfirmBtn}>Delete photo</button>
          </Specimen>
          <Specimen
            label="Library's own family"
            note="library .btnPrimary/.btnSecondary — this stylesheet is shared with 20 PUBLIC routes: never restyle it from the admin side."
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
            label="Pill tabs — shared TabStrip component"
            canonical
            note="SHIPPED Phase A (2026-08-21): calendar, articles, roster (both strips), and roster-import all render this component now — their 4 byte-identical copies (and the .tabOn/.tabActive naming split) are deleted. Import from _components/tab-strip; href items render Links, onSelect items render buttons."
          >
            <TabStrip
              ariaLabel="Specimen"
              activeKey="upcoming"
              items={[
                { key: 'upcoming', label: 'Upcoming', count: 12 },
                { key: 'past', label: 'Past', count: 48 }
              ]}
            />
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
          Phase A COMPLETE (2026-08-21): the four naming families (.badge / .statusPill /
          .pill / .tag) and their per-file tint drift collapsed into the shared Badge
          component — meetings, calendar, articles, roster, roster-import, roll-call,
          court-of-honor, and report all render it now. Rule of thumb: STATUS pills
          (draft/published/active/…) are Badges; CATEGORICAL tags with their own meaning
          (lookups&rsquo; rank/MB/Eagle, meeting-plan&rsquo;s track tags,
          scoutbook-export&rsquo;s type badges) deliberately keep per-screen classes. The
          library workstation is the other exception — its stylesheet is shared with 20
          public routes (D-160).
        </p>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Shared Badge component — all variants"
            canonical
            note="Import from _components/badge. Variants map to the status tokens: neutral, success, warning, danger, info, muted. Base shape: meetings' old .statusPill at pill radius."
          >
            <Badge>Draft</Badge>
            <Badge variant="success">Published</Badge>
            <Badge variant="warning">Pending</Badge>
            <Badge variant="danger">Inactive</Badge>
            <Badge variant="info">Signed up</Badge>
            <Badge variant="muted">Historical</Badge>
          </Specimen>
          <Specimen
            label="Categorical tags — NOT Badges (deliberate)"
            note="Categories are not statuses — mapping them onto status colors would erase a real distinction. These keep their per-screen classes (meeting-plan shown; lookups' rank/MB and scoutbook-export's type badges likewise)."
          >
            <span className={`${plan.tag} ${plan.tagEagle}`}>★ Eagle-required</span>
            <span className={`${plan.tag} ${plan.tagAdult}`}>Adults only</span>
          </Specimen>
        </div>
      </section>

      {/* ════ ACTIONS ▾ ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Actions ▾ Menu</h2>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Actions ▾ — shared ActionsMenu component"
            canonical
            note="✓ DONE Phase A (2026-08-21): every Actions ▾ in the admin renders this component — finance, calendar, roster, court-of-honor, report, meeting-plan, scoutbook-export, and roll-call's list (which had borrowed .dateInput). All three divergents retired; dead per-screen .select copies deleted. Ledger's and articles' .select are FILTER selects (persistent values), correctly not converted."
          >
            <ActionsMenuSpecimen />
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
          The approved spec (<strong>2026-08-21</strong>) SHIPPED as the shared Dialog
          component (<code>_components/dialog</code>) the same day: shadow-lg elevation, 8px
          radius, navy-tinted blurred backdrop, entry motion, banded header/footer zones, and
          a danger variant so destructive confirmations stop looking like edits. The four
          legacy <code>&lt;dialog&gt;</code> copies (calendar, meetings, albums,
          media-manager ×2) are converted — which also delivered the{' '}
          <code>margin:auto</code> / <code>max-height:88vh</code> centering-and-scroll fix
          only calendar&rsquo;s copy used to carry. Backdrop and motion only show on the live
          demo. Compose it as <code>&lt;Dialog&gt;</code> +{' '}
          <code>&lt;DialogHeader/Body/Actions&gt;</code>; pass <code>danger</code> and pair
          it with a solid danger confirm for destructive flows. Remaining families
          (ledger/roster/lookups <code>editDialog</code>…) adopt it in Phase B; media-picker
          uses a custom div overlay — a different mechanism entirely, unified last (high
          risk).
        </p>
        <div className={sg.dialogCompare}>
          <div>
            <div className={`${sg.specimenLabel} ${sg.specimenLabelApproved}`}>
              ✓ Shared Dialog component (approved spec, 2026-08-21)
            </div>
            <div className={`${dlg.dialog} ${sg.dialogStatic}`}>
              <div className={dlg.header}>
                <h3 className={dlg.title}>Edit calendar entry</h3>
                <p className={dlg.sub}>Changes apply immediately when saved.</p>
              </div>
              <div className={dlg.body}>Body content…</div>
              <div className={dlg.actions}>
                <button type="button" className={sg.ghostBtn}>Cancel</button>
                <button type="button" className={sg.demoBtn}>Save</button>
              </div>
            </div>
          </div>
          <div>
            <div className={`${sg.specimenLabel} ${sg.specimenLabelApproved}`}>
              ✓ Danger variant — with its solid danger confirm
            </div>
            <div className={`${dlg.dialog} ${dlg.danger} ${sg.dialogStatic}`}>
              <div className={dlg.header}>
                <h3 className={dlg.title}>Delete this entry?</h3>
                <p className={dlg.sub}>
                  Signups and roll call for it will be removed. This can&rsquo;t be undone.
                </p>
              </div>
              <div className={dlg.body}>Body content…</div>
              <div className={dlg.actions}>
                <button type="button" className={sg.ghostBtn}>Cancel</button>
                <button type="button" className={mm.deleteConfirmBtn}>Delete</button>
              </div>
            </div>
          </div>
          <DialogDemo />
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
