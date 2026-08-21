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
import { PageTitle } from '../_components/page-title';
import { Notice } from '../_components/notice';
import dlg from '../_components/dialog.module.css';
import cal from '../calendar/calendar.module.css';
import ledger from '../advancement/ledger/ledger.module.css';
import coh from '../advancement/court-of-honor/court-of-honor.module.css';
import plan from '../advancement/meeting-plan/meeting-plan.module.css';
import albums from '../news/photo-albums/albums.module.css';
import mm from '../news/media-manager/media-manager.module.css';
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

const FONT_TOKENS = [
  ['--admin-font-ui', "'Open Sans', Arial, sans-serif — all admin chrome", true],
  ['--admin-font-mono', "'Menlo', 'Consolas', monospace — code, IDs, figures", true]
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
      'workbench’s forest Save (a public --forest leak) and the green submits converted to navy; library workstation’s .btnPrimary went navy in Phase C, once it turned out the admin library.module.css is a SEPARATE file from the public one (3 admin importers only)'
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
    copies: '✓ DONE — 0 left (Patrick 2026-08-21: fold everything into the pill TabStrip)',
    canonical: '✓ shared TabStrip everywhere — meeting-plan, court-of-honor, report, library workstation, media-picker converted',
    phase: 'B',
    notes:
      'the admin page stopped consuming library tab classes in Phase B (closes the D-160 backlog item); Phase C then found the admin library.module.css is a separate file from the public one and deleted its dead .tabs family outright'
  },
  {
    pattern: 'Badges / status pills',
    copies: '✓ DONE — 0 status-pill copies left',
    canonical:
      '✓ SHIPPED: shared Badge (neutral/success/warning/danger/info/muted) — meetings, calendar, articles, article-editor, roster, roster-import, roll-call, court-of-honor, report converted 2026-08-21',
    phase: 'A',
    notes:
      'Deliberate exception: CATEGORICAL tags (lookups rank/MB/Eagle, meeting-plan track tags, scoutbook-export type badges) — categories are not statuses. The library workstation exception dissolved in Phase C: its stylesheet turned out to be admin-only (the public copy is a separate file), so its pills were re-tokened in place'
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
    copies: '✓ DONE — both clusters normalized (2026-08-21)',
    canonical:
      'compact = calendar canon (albums, meetings, roster, scoutbook-export, meeting-plan — navy header normalized per Patrick); wrapped-card = ledger canon (articles, finance, records, access)',
    phase: 'B',
    notes:
      'Documented outliers fold in Phase C: lookups, dashboard, media-manager, events-admin; plus the .numCell-vs-inline-textAlign sweep'
  },
  {
    pattern: 'Cards / panels',
    copies: '✓ DONE — merged onto the card canon (2026-08-21)',
    canonical: 'white / gray-200 border / radius token / shadow-sm; padding stays per-screen',
    phase: 'B',
    notes:
      "Deliberate exceptions: audits' warning-accent card; roster-import's interactive disclosure card (different thing sharing the name)"
  },
  {
    pattern: '<dialog> modals',
    copies: '✓ DONE — legacy copies (Phase A) AND the remaining editDialog families (Phase B) all converted',
    canonical:
      '✓ SHIPPED: shared Dialog component (_components/dialog) — every admin modal renders the approved spec, including the formerly hand-rolled PersonEditor overlay (which gained Esc/backdrop close)',
    phase: 'A+B',
    notes: 'library’s quick-add converted in Phase C (its Phase B exception closed — Esc/backdrop close gained); media-picker’s custom div overlay is the one remaining mechanism — unified last, HIGH risk'
  },
  {
    pattern: 'Page titles',
    copies: '✓ DONE — 0 copies left (2026-08-21)',
    canonical:
      '✓ SHIPPED: shared PageTitle component (title / sub / right-side actions) — every admin screen renders it; this page’s own header is the living specimen',
    phase: 'B',
    notes: 'access.module.css also came off rem units in the same pass'
  },
  {
    pattern: 'Error / success notices',
    copies: '✓ DONE — 0 box-notice copies left (2026-08-21)',
    canonical:
      '✓ SHIPPED: shared Notice component on the status tokens (error default + success/warning/info), with alert/status roles the legacy divs lacked',
    phase: 'B',
    notes:
      'Inline text-only field errors are a different idiom, deliberately left — still open, tracked for the Phase D closeout'
  },
  {
    pattern: 'Inline styles',
    copies: '✓ DONE — 170 sites → 12 (2026-08-21), every survivor genuinely dynamic + commented',
    canonical: 'module classes + the token scales',
    phase: 'C',
    notes:
      'survivors: per-category colors from the lookup table, tree-depth indents, a computed bar width, the Satori favicon. login gained login.module.css; rosters deliberately shares events-admin.module.css (same visual family — a separate sheet would recreate the drift)'
  },
  {
    pattern: 'Raw hex + public-token reads in admin CSS',
    copies: '✓ DONE — hex 371 → 59 (−84%); public-token reads 229 → 0; phantom tokens 3 → 0 (2026-08-21)',
    canonical: 'admin.css tokens; --admin-preview-* aliases for WYSIWYG preview surfaces only',
    phase: 'C',
    notes:
      'deliberate survivors: date-picker-field keeps its var(--admin-x, var(--public-x, #hex)) fallback chains (it also serves the public /profile editors, where admin tokens are undefined); the categorical palettes (ledger kind family, lookups/scoutbook/records MB + rank tints — categories are not statuses, no tokens by design); one on-dark warning amber in media-manager'
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
      {/* The page's own header renders the shared PageTitle — the canonical
          specimen for the pattern, in use rather than in a jar. */}
      <PageTitle
        title="Admin Styleguide"
        sub={
          <>
            The canonical version of every recurring Leader Workspace pattern, rendered from
            the live production stylesheets — plus the divergent copies still in the wild,
            side by side, until remediation retires them. Before styling a new screen, find
            the pattern here and import it; if you&rsquo;re about to write a class that looks
            like one of these, stop. Plan: <code>Plans/Admin-Design-System.md</code>.
          </>
        }
      />

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
        <p className={sg.sectionNote}>
          Font stacks (Phase C, 2026-08-21): admin chrome never reads the public font tokens.
        </p>
        {FONT_TOKENS.map(([n, desc]) => (
          <div key={n} className={sg.scaleRow}>
            <span className={sg.scaleName}>{n}</span>
            <span style={{ fontFamily: `var(${n})` }}>{desc}</span>
          </div>
        ))}
        <p className={sg.sectionNote}>
          The <code>--admin-preview-*</code> aliases (font-display, font-body, paper,
          paper-alt, ink, ink-head, ink-meta, border) are the ONE sanctioned coupling to the
          public palette — they alias the public tokens so WYSIWYG surfaces (the markdown
          preview pane, the article preview) keep tracking public rendering by construction.
          Admin chrome must never read them.
        </p>
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
            note="library .btnPrimary/.btnSecondary — Phase C discovery: this admin stylesheet is a SEPARATE file from the public library.module.css (which lives in (public)/library with ~19 importers). The admin copy has 3 workstation importers and was fully re-tokened; .btnPrimary is now navy per the primary decision."
          >
            <button type="button" className={lib.btnPrimary}>Approve</button>
            <button type="button" className={lib.btnSecondary}>Decline</button>
          </Specimen>
        </div>
      </section>

      {/* ════ TABS ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Tab Strips</h2>
        <p className={sg.sectionNote}>
          Phase B COMPLETE (2026-08-21): Patrick&rsquo;s call — ONE tab pattern. The four
          non-pill variants (meeting-plan&rsquo;s underline tabs, court-of-honor&rsquo;s and
          the report&rsquo;s view tabs, the library workstation&rsquo;s tabs, media-picker&rsquo;s
          tabs) all fold into the shared pill TabStrip. The library conversion touched only
          the admin page, which also closes the D-160 backlog item. (Phase C then found the
          admin <code>library.module.css</code> is a separate file from the public
          one — the dead tab classes were deleted from the admin copy outright.)
        </p>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Pill tabs — shared TabStrip component"
            canonical
            note="THE tab pattern — data tabs and view/mode toggles alike. Import from _components/tab-strip; href items render Links, onSelect items render buttons; count renders the pill badge."
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
          library-workstation exception dissolved in Phase C — its stylesheet turned out to
          be admin-only (the public copy is a separate file), so its pills were re-tokened.
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
          Phase B COMPLETE (2026-08-21): both clusters normalized within themselves — compact
          (calendar canon: albums, meetings, roster, scoutbook-export, plus meeting-plan,
          whose navy header Patrick chose to normalize) and wrapped-card (ledger canon:
          articles, finance, records, access). Remaining outliers (lookups, dashboard,
          media-manager, events-admin) are documented, not drift-by-accident — they fold in
          Phase C alongside the <code>.numCell</code>-vs-inline-<code>textAlign</code> sweep.
        </p>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Compact cluster"
            canonical
            note="calendar canon — 12.5px, tight padding, uppercase gray headers. Members: calendar, albums, meetings, roster, scoutbook-export, meeting-plan."
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
            note="ledger canon — .tableWrap card container, roomier padding, 2px header rule. Members: ledger, articles, finance, records, access. Numeric cells use .numCell."
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
        </div>
      </section>

      {/* ════ CARDS ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Cards &amp; Panels</h2>
        <p className={sg.sectionNote}>
          Phase B COMPLETE (2026-08-21): the .panel family (events-admin, meetings, workbench)
          and the shadow-less coh/report cards now share the card canon — white, gray-200
          border, radius token, shadow-sm; padding stays per-screen. Deliberate exceptions:
          audits&rsquo; warning-accent card and roster-import&rsquo;s interactive disclosure
          card (a different thing wearing the name).
        </p>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Card"
            canonical
            note="White, gray-200 border, var(--admin-radius), shadow-sm. The .panel classes keep their names but carry these values now."
          >
            <div className={util.card} style={{ width: '100%' }}>
              <div className={util.cardSoon}>Card content</div>
            </div>
          </Specimen>
        </div>
      </section>

      {/* ════ NOTICES ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Notices &amp; Errors</h2>
        <p className={sg.sectionNote}>
          Phase B COMPLETE (2026-08-21): the four per-screen names (.rowError / .editError /
          .fieldError / .notice) and the 11-file pale-tint cluster behind them collapsed into
          the shared Notice component on the status tokens. Errors announce with{' '}
          <code>role=&quot;alert&quot;</code>; other variants use{' '}
          <code>role=&quot;status&quot;</code> — semantics the legacy divs never had. Inline
          text-only field errors (no box) are a separate idiom and were left alone.
        </p>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Shared Notice component — all variants"
            canonical
            note="Import from _components/notice. Default variant is error (most call sites); className is for layout-only margin adjustments."
          >
            <div style={{ display: 'grid', gap: 8, width: '100%' }}>
              <Notice>Something went wrong saving this row.</Notice>
              <Notice variant="success">Import complete — 3 people added.</Notice>
              <Notice variant="warning">This entry has no category yet.</Notice>
              <Notice variant="info">Signups close Friday at 6:00 PM.</Notice>
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
          it with a solid danger confirm for destructive flows; width variants are a slim
          per-screen size-only class via <code>className</code> (doubled selector for
          deterministic override). Phase B converted the remaining families too —
          ledger/roster/lookups/finance/fast-entry/rosters, including the two formerly
          hand-rolled overlays (PersonEditor, adult-form), which gained Esc and
          backdrop-click close. Phase C closed the library quick-add exception (shared
          Dialog, Esc/backdrop close gained). Remaining exceptions: fast-entry&rsquo;s MB
          focus modal (needs a close-guard prop for its unsaved-ticks confirm);
          media-picker&rsquo;s custom div overlay unifies last (high risk).
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
