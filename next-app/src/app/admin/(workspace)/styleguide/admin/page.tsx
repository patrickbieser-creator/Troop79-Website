/**
 * /admin/styleguide/admin — the Leader Workspace pattern library and
 * consistency tracker (Plans/Admin-Design-System.md, 2026-08-21). Reached via
 * the /admin/styleguide chooser since Phase 0d of the public design system
 * (Plans/Public-Design-System.md) added a second, public guide beside it.
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
import { SaveDemo } from './save-demo';
import { fmtDate, fmtDateLong, fmtDateFull, fmtDay, fmtDateTime, fmtMonthYear, fmtRange } from '@/lib/format-date';
import { ActionsMenuSpecimen, SearchFieldSpecimen, SortHeaderSpecimen } from './specimens';
import { TabStrip } from '../../_components/tab-strip';
import { AddButton } from '../../_components/add-button';
import { Button } from '../../../_components/button';
import { FormPanel, FormSection } from '../../../_components/form-panel';
import { Badge } from '../../_components/badge';
import { BackNav } from '../../_components/back-nav';
import { PublicPageLink } from '../../../_components/public-page-link';
import { HelpBadge } from '../../../_components/help-badge';
import { RecentItemsList } from '../../_components/recent-items-list';
import { PageTitle } from '../../_components/page-title';
import { Notice } from '../../_components/notice';
import dlg from '../../_components/dialog.module.css';
import me from '../../_components/message-editor-dialog.module.css';
import dt from '../../_components/data-table.module.css';
import cal from '../../calendar/calendar.module.css';
import plan from '../../advancement/meeting-plan/meeting-plan.module.css';
import ev from '../../events/events-admin.module.css';
import mm from '../../news/media-manager/media-manager.module.css';
import util from '../../utilities/utilities.module.css';
import board from '../../rosters/[id]/assignments/assignments.module.css';

export const metadata = {
  title: 'Admin Styleguide — Troop 79'
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
  ['--admin-white', '#ffffff', false],
  // Form-field standard (2026-08-21, Patrick: fields "too blurred with the
  // background"): every text input/select/textarea under .adminRoot sits on
  // --admin-field-bg and goes white on focus — one scoped rule in
  // admin.module.css; module sheets read the token, never --admin-white.
  ['--admin-field-bg', '#ffffff · every text field/select/textarea, admin-wide (scoped rule in admin.module.css)', true],
  ['--admin-field-bg-focus', '#ffffff · the same field on focus', true],
  ['--admin-form-bg', '#eef1f5 · the surface AROUND fields: Dialog body, form panels, .editGrid blocks (Patrick: "flip the panels to tinted and fields to white")', true]
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
  ['--admin-status-info-bg', '#eef3f8', true],
  ['--admin-cat-rank-bg', '#e0e7ef · navy text', true],
  ['--admin-cat-mb-bg', '#e3eee5 · forest text', true],
  // Indexed categorical scale (2026-08-21) — DB-governed vocabularies with
  // no fixed meaning per value; slot by position (finance Kind pills).
  ['--admin-cat-1-bg', '#d6efef · fg #186e72 (teal) — indexed scale 1/8', true],
  ['--admin-cat-2-bg', '#ddeedd · fg #2f6b2f (green)', true],
  ['--admin-cat-3-bg', '#fde0e0 · fg #a03737 (red)', true],
  ['--admin-cat-4-bg', '#fce6dc · fg #b54d22 (orange)', true],
  ['--admin-cat-5-bg', '#fff0d6 · fg #946b00 (gold)', true],
  ['--admin-cat-6-bg', '#ece0f0 · fg #6b3f7a (plum)', true],
  ['--admin-cat-7-bg', '#dde8f7 · fg #2b4f8a (blue)', true],
  ['--admin-cat-8-bg', '#e6e6ea · fg #4a4a5a (slate)', true]
] as const;

const FONT_TOKENS = [
  ['--admin-font-ui', 'Open Sans via next/font (var(--font-open-sans)), Arial fallback — all admin chrome', true],
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
    pattern: 'Shared Button component (variants)',
    copies: '✓ SHIPPED 2026-08-24 — admin/_components/button; SaveButton/DiscardButton adopt it',
    canonical: 'primary · secondary · danger · dangerSolid · quiet × md/sm — the ONLY button variants',
    phase: 'D',
    notes: 'this row is the guard: a new variant is added HERE and to the component, never as a per-screen class; per-screen leftovers are listed in the Buttons specimen notes'
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
    copies: '15 of 16 <table> screens compose the shared sheet (wave 2, 2026-08-25)',
    canonical:
      'ONE stylesheet: _components/data-table.module.css — .compact (calendar canon; composed by albums, meetings, meeting-plan, roster, scoutbook-export, dashboard, lookups, media-manager, patrols), .card + .cardWrap (ledger canon, composes too; records, finance/reimbursements, articles, access), .dense (events-admin roster canon — rules still literal there, .dense ready to compose). Seven names: Compact, Card, Dense Grid, RecordList, Board, ExpandableSummary, PrintTable',
    phase: 'B',
    notes:
      'Left: events-admin .table onto .dense (another agent owns events/ this session); fast-entry’s audit tape (.tapeTable, a receipt-style tape, not one of the seven) keeps its own .cellRight for Qty; the .cellRight/.alignRight classes that remain (lookups, meeting-plan) are on Actions columns, not numbers — candidates for .actionsCell, not .numCell. History: Phase B normalized the two clusters (2026-08-21); Phase C swept inline textAlign; SortHeader/useSortable (_components/use-sortable) is the client-side sort; finance’s URL-param server sort is deliberately separate; stretched-link rows (.rowLink) on calendar, scouts, people, articles'
  },
  {
    pattern: 'Cards / panels',
    copies: '✓ DONE — card canon 2026-08-21; form-surface split completed 2026-08-22',
    canonical:
      'gray-200 border / radius token / shadow-sm. BACKGROUND depends on the job: a panel that HOLDS FIELDS is --admin-form-bg (D-179), a display-only card stays --admin-white',
    phase: 'B',
    notes:
      "The calendar workbench and meetings panels were still white-on-white until 2026-08-22 — both hold field grids. Deliberate exceptions: audits' warning-accent card; roster-import's interactive disclosure card (different thing sharing the name)"
  },
  {
    pattern: '<dialog> modals',
    copies: '✓ DONE — legacy copies (Phase A) AND the remaining editDialog families (Phase B) all converted',
    canonical:
      '✓ SHIPPED: shared Dialog component (_components/dialog) — every admin modal renders the approved spec, including the formerly hand-rolled PersonEditor overlay (which gained Esc/backdrop close)',
    phase: 'A+B',
    notes:
      'ZERO non-Dialog modals remain (2026-08-21): library’s quick-add converted in Phase C, then the last two fell in the tail session — fast-entry’s MB focus modal (via the new closeOnBackdrop={false} + onBackdropAttempt props; its unsaved-ticks guard is the exemplar of consumer-owned close decisions) and media-picker’s custom div overlay (nested dialogs stack via the platform top layer)'
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
      'deliberate survivors: date-picker-field keeps its var(--admin-x, var(--public-x, #hex)) fallback chains (it also serves the public /profile editors, where admin tokens are undefined); the ledger ACTIVITY-kind palette (camping/hiking/outing/fundraiser/service/leadership — categorical by design); one on-dark warning amber in media-manager. The MB/rank tints got real tokens 2026-08-21 (Patrick: normalize the drift) — --admin-cat-rank-bg/--admin-cat-mb-bg, one meaning per color on all four screens'
  },
  {
    pattern: 'Eyebrow labels (11px/700/uppercase)',
    copies: '✓ DONE — 0 label re-declarations left (Phase D, 2026-08-21); ~96 adminLabel call sites',
    canonical: '✓ SHIPPED: global .adminLabel utility in admin.css (2026-08-21)',
    phase: 'A',
    notes:
      'Phase D retired every true label re-declaration (drifted tracking/color/size folded onto the utility — .04–.12em → .08em, gray-600/700 → gray-500, 10–10.5px → 11px). What still shares the typography is OTHER patterns, on purpose: table th, pills, buttons, composite headers — plus two distinct-role survivors (events stat-tile .tileLabel, library .groupSectionLabel at tracking-widest)'
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
        back={{ label: 'Styleguides', href: '/admin/styleguide' }}
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
            note="SHIPPED Phase A, adoption COMPLETE Phase D (2026-08-21): ~96 call sites; the 32 per-file re-declarations are gone. Typography only — consumers add display/margin themselves; overrides of utility-set props (e.g. a navy label) must out-specify (0,1,0) via an element qualifier or doubled class, never rely on stylesheet order."
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
            label="Shared Button — every variant and size"
            canonical
            note="2026-08-24 (Patrick: 'let's do it'): ONE component for the 113 per-screen button classes. Import from admin/_components/button (one level above (workspace) so roster-print and snapshot reach it). variant: primary (navy — Save/Publish/Apply), secondary (default — Edit/Clone/Cancel/pager), danger (outlined, in-context), dangerSolid (ONLY the confirm inside a danger Dialog), quiet (link-styled). size: md (forms, panel heads) or sm (table rows, dense toolbars — the old .editBtn). href renders a Link; type defaults to button. SaveButton/DiscardButton render it by default. Variants row below must stay EMPTY of new entries — add a variant here, never a per-screen class."
          >
            <Button variant="primary">Save changes</Button>
            <Button>Cancel</Button>
            <Button variant="danger">Delete</Button>
            <Button variant="dangerSolid">Delete permanently</Button>
            <Button variant="quiet">Take Roll Call →</Button>
            <Button variant="primary" size="sm">Apply</Button>
            <Button size="sm">Edit</Button>
            <Button size="sm" variant="danger">Delete</Button>
            <Button href="/admin/styleguide/admin" size="sm">As a link</Button>
            <Button disabled>Disabled</Button>
          </Specimen>
          <Specimen
            label="Add button — shared AddButton component"
            canonical
            note="Phase A COMPLETE (2026-08-21): every green Add in the workspace renders this component — calendar, articles, albums, the 7 lookups editors, roster (converted from its navy one-off, Patrick's call), and roll-call's seed action. Import from _components/add-button; href renders a Link, onClick a button; disabled supported."
          >
            <AddButton>+ Add Event</AddButton>
          </Specimen>
          <Specimen
            label="Row actions — quiet, size sm"
            canonical
            note="The per-row Edit / Void / Delete idiom (was ledger's .actionBtn, identical in articles — both retired 2026-08-24). variant='quiet' size='sm'; the destructive one is variant='danger' size='sm'."
          >
            <Button variant="quiet" size="sm">Edit</Button>
            <Button variant="danger" size="sm">Void</Button>
          </Specimen>
          <Specimen
            label="Primary — navy (decided 2026-08-21)"
            canonical
            note="Patrick's Phase A call: primaries are NAVY; green stays reserved for Add/create, so color carries meaning. Now simply variant='primary' — court-of-honor's .primaryBtn, the last per-screen copy the styleguide pointed at, is gone."
          >
            <Button variant="primary">Publish</Button>
          </Specimen>
          <Specimen
            label="Danger — both, with rules (decided 2026-08-21)"
            canonical
            note="Patrick's Phase A call: OUTLINED (variant='danger') for in-context destructive actions — quiet until hovered; SOLID (variant='dangerSolid') reserved for the confirm button inside a danger Dialog."
          >
            <Button variant="danger">Delete</Button>
            <Button variant="dangerSolid">Delete photo</Button>
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
          <Specimen
            label="Tabbed workbench — long multipart editors"
            canonical
            note="Patrick 2026-08-24 (calendar entry workbench): a record with several independently-saved parts gets ONE pill tab per part, above the panel, so the options are evident at the top instead of stacked down the page. Rules: the same TabStrip in onSelect mode; every panel stays MOUNTED and is hidden with the `hidden` attribute (role=tabpanel, aria-label = tab name) so an unsaved draft on one tab survives a look at another; a tab whose part has content shows it as the count pill (Roll Call: people present); a tab with an unsaved draft gets a trailing • in its label; tabs a record can't have (Agenda on a non-meeting) are omitted, not disabled. Optional ?tab= deep link for back links from the part's own screen. A part with its own groups may nest a second TabStrip as a SUB-tab bar inside its panel (Roll Call's Scouts / Leaders / Adults) — the layer tabs stay put. Reference: calendar/[id]/workbench.tsx."
          >
            <TabStrip
              ariaLabel="Specimen workbench"
              activeKey="story"
              items={[
                { key: 'details', label: 'Details' },
                { key: 'story', label: 'Story •' },
                { key: 'agenda', label: 'Agenda' },
                { key: 'roll-call', label: 'Roll Call', count: 14 },
                { key: 'signup', label: 'Signup' }
              ]}
            />
          </Specimen>
        </div>
      </section>

      {/* ════ BADGES ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Help Badge</h2>
        <p className={sg.sectionNote}>
          The <code>?</code> beside the thing it explains (Patrick, 2026-08-25; tuned on{' '}
          <a href="/admin/styleguide/help-sample">the sample page</a>: 320px, 20px circle, click only).
          A popover, not a tooltip &mdash; opens on click / tap / Enter, closes on Esc with focus
          returning, on &times; or a click away; never on hover, never on a timer. Copy lives in{' '}
          <code>admin/help.tsx</code>, keyed by id, so instructions are reviewed in one place; a typo
          in an id throws in dev. Use it for REFERENCE (what a symbol means, how a number is
          computed) &mdash; never for what a leader must know before acting. Rule: AGENTS.md &rarr;
          On-screen instructions.
        </p>
        <div className={sg.specimenGrid}>
          <div className={`${sg.specimen} ${sg.specimenCanonical}`}>
            <div className={sg.specimenLabel}>In a table header</div>
            <table className={cal.table}>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>
                    Status <HelpBadge id="calendar.status" />
                  </th>
                  <th className={cal.goingHead}>
                    Going <HelpBadge id="calendar.going" />
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Fall Campout</td>
                  <td>
                    <span className={cal.statusCell}>
                      <span className={`${cal.pill} ${cal.pillLive}`}>S</span>
                    </span>
                  </td>
                  <td className={cal.goingCell}>23</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className={`${sg.specimen} ${sg.specimenCanonical}`}>
            <div className={sg.specimenLabel}>Beside a label</div>
            <p className={sg.specimenNote}>
              Promote to homepage <HelpBadge id="calendar.promote" /> &mdash; the badge follows the
              words it explains, inline, and never wraps to its own line.
            </p>
          </div>
        </div>
      </section>

      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Back Navigation</h2>
        <p className={sg.sectionNote}>
          The one way back, in the one place (Patrick, 2026-08-25). <code>PageTitle</code> REQUIRES
          a <code>back</code> prop and renders <code>BackNav</code> in a fixed slot above the h1:
          <code>back=&#123;null&#125;</code> on a list (it remembers its own URL, filters and all, for
          its children); <code>&#123; label, href &#125;</code> at depth 2 (&ldquo;&larr; Back to
          News&rdquo;); <code>&#123; crumbs, current &#125;</code> at depth 3+ (breadcrumbs, last crumb
          not a link, folds to one hop under 420px). A dirty form gets a Discard-changes dialog
          before leaving. Never a back link in <code>children</code> or <code>sub</code> again.
        </p>
        <div className={sg.specimenGrid}>
          <div className={`${sg.specimen} ${sg.specimenCanonical}`}>
            <div className={sg.specimenLabel}>Depth 2 &mdash; back link</div>
            <BackNav back={{ label: 'News', href: '/admin/news/articles' }} />
          </div>
          <div className={`${sg.specimen} ${sg.specimenCanonical}`}>
            <div className={sg.specimenLabel}>Depth 3+ &mdash; breadcrumbs</div>
            <BackNav
              back={{
                crumbs: [
                  { label: 'Calendar', href: '/admin/calendar' },
                  { label: 'Fall Campout', href: '/admin/calendar/1?tab=signup' }
                ],
                current: 'Money'
              }}
            />
          </div>
        </div>

        <h3 className={sg.subHead}>Public Page Link</h3>
        <p className={sg.sectionNote}>
          The admin &rarr; public link, one component (<code>PublicPageLink</code>, Jenna 2026-08-25):
          secondary / sm, same tab, &ldquo;View public page&rdquo; &mdash; or &ldquo;Preview
          (unpublished)&rdquo; for a draft, never hidden. It sits in <code>PageTitle</code>&rsquo;s
          children (rosters, news editor) or the screen&rsquo;s <code>.headActions</code> where there is
          no PageTitle (calendar workbench, meeting editor). Never in <code>sub</code>.
        </p>
        <div className={sg.specimenGrid}>
          <div className={`${sg.specimen} ${sg.specimenCanonical}`}>
            <div className={sg.specimenLabel}>Published</div>
            <PublicPageLink href="/events/1" />
          </div>
          <div className={`${sg.specimen} ${sg.specimenCanonical}`}>
            <div className={sg.specimenLabel}>Draft</div>
            <PublicPageLink href="/news/fall-campout" draft />
          </div>
        </div>
      </section>

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
            label="Letter status pills — calendar list (.pill)"
            canonical
            note="Patrick 2026-08-24, when the Roll Call list folded into the Calendar: a row that carries several LAYERS shows one letter per layer instead of a wordy Badge each — A agenda, S signup, R roll call taken, O off the calendar. Tones: green live, yellow draft, grey closed, RED for the exception (O shows only when an entry is off-calendar; on-calendar is the norm and shows nothing). Every letter keeps its own 18px slot (.pillSlot) so pills align down a list. The whole word is the hover/aria-label; a pill whose layer has a screen renders as a Link to it. Rules + order: lib/calendar-list.ts statusPills() / PILL_COLUMNS. Use it where one row summarizes several parts; keep Badges for a single status word."
          >
            <span className={cal.statusCell}>
              <span className={`${cal.pill} ${cal.pillLive}`} title="Agenda published">A</span>
              <span className={`${cal.pill} ${cal.pillDraft}`} title="Agenda draft">A</span>
              <span className={`${cal.pill} ${cal.pillLive}`} title="Signup open">S</span>
              <span className={`${cal.pill} ${cal.pillClosed}`} title="Signup closed">S</span>
              <span className={`${cal.pill} ${cal.pillLive}`} title="Roll call taken">R</span>
              <span className={`${cal.pill} ${cal.pillOff}`} title="Off calendar">O</span>
            </span>
            <div>
              <span className={cal.statusCell}>
                <span className={cal.pillSlot} aria-hidden="true" />
                <span className={`${cal.pill} ${cal.pillLive}`} title="Signup open">S</span>
                <span className={cal.pillSlot} aria-hidden="true" />
                <span className={`${cal.pill} ${cal.pillOff}`} title="Off calendar">O</span>
              </span>
            </div>
          </Specimen>
          <Specimen
            label="Categorical tags — NOT Badges (deliberate)"
            note="Categories are not statuses — mapping them onto status colors would erase a real distinction. These keep their per-screen classes (meeting-plan shown; lookups' rank/MB and scoutbook-export's type badges likewise)."
          >
            <span className={`${plan.tag} ${plan.tagEagle}`}>★ Eagle-required</span>
            <span className={`${plan.tag} ${plan.tagAdult}`}>Adults only</span>
          </Specimen>
          <Specimen
            label="Inline annotation — .offEventNote (signup builder)"
            note="NOT a Badge and not a status: it annotates a value with a fact about it. Amber (--admin-accent-gold), no chrome, sits under the value it qualifies. A signup job dated outside its event is FREQUENTLY correct — the shopping run on the Thursday before a Friday campout — so it must read as worth noticing, never as an error. Added 2026-08-22 after a job two weeks adrift on a cloned event was invisible in a dense date column. Reach for a Notice instead when the thing needs acting on, and a Badge when it is a state rather than a remark."
          >
            <span>
              2026-09-02 17:00–19:00
              <span className={ev.offEventNote}>14 days before the event</span>
            </span>
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
        <h2 className={sg.sectionHead}>List Search</h2>
        <p className={sg.sectionNote}>
          One name search for in-memory lists (Patrick, 2026-08-25; Jenna&rsquo;s pass):{' '}
          <code>useTableSearch(rows, fields)</code> + <code>&lt;SearchField&gt;</code> from{' '}
          <code>_components/search-field</code> &mdash; instant, case-insensitive, Esc clears, &ldquo;N of M&rdquo;
          announced. Same slot on every screen: the table&rsquo;s toolbar row, after any sub-tab strip or
          count, before the spacer and the Add button. Server-listed screens (Calendar, News, Ledger)
          keep their URL-debounced <code>q</code>; the two are different canons for different data.
          Consumers: roster Scouts / Leaders / Adults / Guests / Patrols.
        </p>
        <div className={sg.specimenGrid}>
          <div className={`${sg.specimen} ${sg.specimenCanonical}`}>
            <div className={sg.specimenLabel}>Canonical</div>
            <SearchFieldSpecimen />
          </div>
        </div>
      </section>

      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Data Tables</h2>
        <p className={sg.sectionNote}>
          Seven named patterns (Patrick approved them in{' '}
          <a href="/prototypes/admin-tables-prototype.html">the prototype</a>, 2026-08-25). The three
          <code>&lt;table&gt;</code> patterns share one stylesheet, <code>_components/data-table.module.css</code>:{' '}
          <code>.compact</code>, <code>.card</code> (+ <code>.cardWrap</code>), <code>.dense</code>, plus the
          cell behaviours <code>.rowLink</code>, <code>.actionsCell</code>, <code>.numCell</code>,{' '}
          <code>.empty</code>. A screen adopts one with <code>composes</code> on its own <code>.table</code>{' '}
          class — no markup change, no per-screen table rules; genuine extras (column widths, sticky
          headers, responsive hides) stay, and an override of a shared declaration uses the doubled
          selector (<code>.table.table td</code>) so it wins regardless of bundle order.{' '}
          <strong>DataTable·Compact</strong> — a list you scan and click into; calendar canon, composed by
          albums, meetings, meeting-plan, roster, scoutbook-export, dashboard, lookups, media-manager,
          patrols (wave 2). <strong>DataTable·Card</strong> — rows with money or per-row buttons in a wrapped
          card; ledger canon (composes too, so there is one source), plus records, finance (+ its
          reimbursements queue), articles, access (its sticky-thead extra kept). <strong>DataTable·Dense
          Grid</strong> — a matrix with many narrow columns; events-admin roster is the canon and still
          carries its own literal rules (<code>.dense</code> is ready for it to compose). The other four
          are not <code>&lt;table&gt;</code>s: <strong>RecordList</strong>, <strong>Board</strong>,{' '}
          <strong>ExpandableSummary</strong>, <strong>PrintTable</strong> — see their notes below.
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
            label="Sortable headers — shared SortHeader + useSortable"
            canonical
            note="Import from _components/use-sortable. aria-sort carries the state; initialKey null preserves a table's deliberate default order until the first click. Client-side tables only — finance's URL-param server sort is a different mechanism, deliberately separate. idleArrow={false} drops the ↕ on inactive headers for dense grids (event roster, 2026-08-22 — Patrick read them as stray quote marks); the active column still shows ▲/▼."
          >
            <SortHeaderSpecimen />
          </Specimen>
          <Specimen
            label="Roster grid — stacked header, tight cells, class pill, job-code columns (events-admin .thStack / .cellTight / .noteCell / .classPill / .jobBand / .jobTick)"
            canonical
            note="Roster grid space-savers (2026-08-22): a two-word header stacks ('Driving' over 'To') so the column stays as narrow as its one-number cells; the two lines are separate spans so the accessible name still reads 'Driving To'. .noteCell keeps notes to one line with the full text on hover (title). .classPill is CATEGORICAL on the indexed scale — youth classes light (S red · JL teal · Cub gold · W orange · G plum), adult classes dark (A blue, adult-guest G plum) — not the status Badge, per badge.tsx's scope rule. Job-code columns (2026-08-23, job-heavy events): ONE narrow column per job headed by its 1–5 char code (.thCenter; full label · when · coverage in the title), a .jobTick when claimed, blank otherwise; when jobs span days a .jobBand row (scope=colgroup) groups the codes under 'Fri 10/9 · Sat 10/10 · Anytime'. Beside a label (Edit dialog, Builder list) the code is plain text in parentheses — 'Setup crew (SC)'. Codes come from lib/job-codes — leader-set or derived from the label, unique per event."
          >
            <table className={ev.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Class</th>
                  <th><span className={ev.thStack}><span>Driving</span> <span>To</span></span></th>
                  <th><span className={ev.thStack}><span>Ride</span> <span>To</span></span></th>
                  <th className={ev.thCenter} title="Cashier · Sat Oct 10 · 9:00 AM–12:00 PM · 1 of 2 claimed">CASH</th>
                  <th className={ev.thCenter} title="Setup crew · Fri Oct 9 · 1 of 4 claimed">SC</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Patrick Bieser</td>
                  <td title="Adult"><span className={`${ev.classPill} ${ev.classA}`}>A</span></td>
                  <td className={ev.cellTight}>4</td>
                  <td className={ev.cellTight} />
                  <td className={ev.cellTight} title="Cashier — has a cash box"><span className={ev.jobTick}>✓</span></td>
                  <td className={ev.cellTight} title="Setup crew" />
                  <td className={`${ev.cellMuted} ${ev.noteCell}`} title="Arriving late Friday, bringing the trailer">Arriving late Friday, bringing the trailer</td>
                </tr>
                <tr>
                  <td>Anjali Sankpal-Tatera</td>
                  <td title="Scout"><span className={`${ev.classPill} ${ev.classS}`}>S</span></td>
                  <td className={ev.cellTight} />
                  <td className={ev.cellTight}>PBieser</td>
                  <td className={ev.cellTight} title="Cashier" />
                  <td className={ev.cellTight} title="Setup crew"><span className={ev.jobTick}>✓</span></td>
                  <td className={`${ev.cellMuted} ${ev.noteCell}`}>—</td>
                </tr>
                <tr>
                  <td>Six classes</td>
                  <td colSpan={6}>
                    <span className={`${ev.classPill} ${ev.classS}`}>S</span>{' '}
                    <span className={`${ev.classPill} ${ev.classA}`}>A</span>{' '}
                    <span className={`${ev.classPill} ${ev.classJL}`}>JL</span>{' '}
                    <span className={`${ev.classPill} ${ev.classCub}`}>Cub</span>{' '}
                    <span className={`${ev.classPill} ${ev.classW}`}>W</span>{' '}
                    <span className={`${ev.classPill} ${ev.classG}`} title="Youth guest">G</span>{' '}
                    <span className={`${ev.classPill} ${ev.classAG}`} title="Adult guest">G</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </Specimen>
          <Specimen
            label="DataTable·Card — shared .cardWrap / .card / .numCell / .actionsCell"
            canonical
            note="Rendered straight from data-table.module.css. Ledger canon: white card with shadow (the card is the scroll-x container), 13px, 10px 12px cells, 11px uppercase headers over a 2px rule. Money is .numCell (right, tabular-nums; negatives red-in-parens-with-minus per 2026-08-22). Row actions are the shared Button, quiet / danger, size sm, in an .actionsCell. Composed by ledger, records, finance, articles, access."
          >
            <div className={dt.cardWrap}>
              <table className={dt.card}>
                <thead>
                  <tr><th>Activity</th><th className={dt.numCell}>Amount</th><th className={dt.actionsCell}>Actions</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Summer Camp</td>
                    <td className={dt.numCell}>$425.00</td>
                    <td className={dt.actionsCell}>
                      <Button variant="quiet" size="sm">Edit</Button>
                      <Button variant="danger" size="sm">Delete</Button>
                    </td>
                  </tr>
                  <tr>
                    <td>Wreath Sale</td>
                    <td className={dt.numCell}>$118.50</td>
                    <td className={dt.actionsCell}>
                      <Button variant="quiet" size="sm">Edit</Button>
                      <Button variant="danger" size="sm">Delete</Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Specimen>
          <Specimen
            label="DataTable·Dense Grid — shared .dense"
            canonical
            note="Rendered straight from data-table.module.css. Events-admin roster canon: the table is its own bordered white surface, 13.5px, 9px 12px cells, 10.5px uppercase gray-600 headers on a 1px rule, top-aligned cells. For a matrix (people × slots, scouts × requirements) with many narrow columns; the stacked-header / class-pill / job-tick extras stay in events-admin.module.css (specimen above)."
          >
            <table className={dt.dense}>
              <thead>
                <tr><th>Name</th><th>Fri</th><th>Sat</th><th>Sun</th><th className={dt.numCell}>Seats</th></tr>
              </thead>
              <tbody>
                <tr><td>Patrick Bieser</td><td>✓</td><td>✓</td><td>✓</td><td className={dt.numCell}>4</td></tr>
                <tr><td>Anjali Sankpal-Tatera</td><td>✓</td><td>✓</td><td /><td className={dt.numCell}>0</td></tr>
              </tbody>
            </table>
          </Specimen>
          <Specimen
            label="RecordList — shared RecentItemsList"
            note="Not a <table>: a list of records you open, one card each. Lives in _components/recent-items-list (specimen in Recent Items List, below); it replaced the two drifted .reportList copies on the advancement report and court-of-honor sidebars. The audits (advancement/report, court-of-honor) are its members — their earlier per-screen card findings (active card = navy border + aria-current) are folded into the component."
          >
            <p className={sg.specimenNote}>See <strong>Recent Items List</strong> below for the live specimen.</p>
          </Specimen>
          <Specimen
            label="Board — rosters/[id]/assignments"
            note="Not a <table>: capacity cards with chips you move between them. The Rides & assignments board is the only board in the workspace (the patrol page is a Compact table now); its specimen is Assignment Board, below."
          >
            <p className={sg.specimenNote}>See <strong>Assignment Board</strong> below for the live specimen.</p>
          </Specimen>
          <Specimen
            label="ExpandableSummary — finance/report/activity-report.tsx"
            note="Not a <table> on purpose: summary rows that expand into a drill-down. Built from <details> on one shared CSS-grid class (report.module.css .reportGrid) used by both the header and every row, so they stay aligned by construction — a native table header and a grid <details> body can't be guaranteed to align, and <details> can't legally be a <tr>. The rationale comment at the top of activity-report.tsx is the spec; do not rebuild it as a table."
          >
            <p className={sg.specimenNote}>Live at <strong>/admin/finance/report</strong>.</p>
          </Specimen>
          <Specimen
            label="PrintTable — admin/roster-print + admin/snapshot"
            note="The two print surfaces above (workspace) — /admin/roster-print and /admin/snapshot/[id] — share the same .table (token-sized: text-xs cells, 3px 6px padding, uppercase 2xs headers, break-inside: avoid on rows) and .plainList (bare list for sub-items) idiom, tuned for paper rather than the screen scales. Print-only; they do not compose data-table.module.css."
          >
            <p className={sg.specimenNote}>Live at <strong>/admin/roster-print</strong> and <strong>/admin/snapshot/[id]</strong>.</p>
          </Specimen>
        </div>
      </section>

      {/* ════ CARDS ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Recent Items List</h2>
        <p className={sg.sectionNote}>
          The sidebar list of recent reports / ceremonies &mdash; one shared{' '}
          <code>RecentItemsList</code> (<code>_components/recent-items-list</code>) since 2026-08-25,
          replacing two drifted <code>.reportList</code> copies. Each item is a clickable card; the
          active one carries the navy border and <code>aria-current=&quot;page&quot;</code>.
          The RecordList pattern of the tables consolidation.
        </p>
        <div className={sg.specimenGrid}>
          <div className={`${sg.specimen} ${sg.specimenCanonical}`}>
            <div className={sg.specimenLabel}>Canonical</div>
            <RecentItemsList
              ariaLabel="Recent reports"
              activeKey="b"
              items={[
                { key: 'a', href: '#', label: 'Fall 2026 Court of Honor', meta: 'Sep 14', badge: <Badge variant="success">Final</Badge> },
                { key: 'b', href: '#', label: 'Weekly advancement', meta: 'Aug 24', badge: <Badge variant="warning">Draft</Badge> },
                { key: 'c', href: '#', label: 'Summer camp recap', meta: 'Aug 2' }
              ]}
            />
          </div>
        </div>
      </section>

      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Cards &amp; Panels</h2>
        <p className={sg.sectionNote}>
          Phase B COMPLETE (2026-08-21): the .panel family (events-admin, meetings, workbench)
          and the shadow-less coh/report cards share the card canon — gray-200 border, radius
          token, shadow-sm; padding stays per-screen. Deliberate exceptions: audits&rsquo;
          warning-accent card and roster-import&rsquo;s interactive disclosure card (a
          different thing wearing the name).
        </p>
        <p className={sg.sectionNote}>
          <strong>Background is not part of the canon — the job decides it.</strong> A panel
          that HOLDS FIELDS carries <code>--admin-form-bg</code> so the white inputs inside it
          read as fields (D-179, v1.71.1); a display-only card stays <code>--admin-white</code>.
          The calendar workbench and the meetings panels were still white-on-white until
          2026-08-22 — both wrap field grids — which is why this line now exists rather than
          leaving &ldquo;panels are white&rdquo; to mislead the next reader.
        </p>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Shared FormPanel + FormSection — the surfaces that hold fields"
            canonical
            note="2026-08-24 (the FormPanel backlog item): import from admin/_components/form-panel. FormPanel = the tinted field surface (--admin-form-bg, gray-200 border, radius, shadow-sm) with optional uppercase title, actions slot (Save / Discard / feedback) and note; inputs inside it read white automatically. FormSection = the numbered section card promoted from the scout editor (navy left rule, circled number, uppercase title, actions, sectionRef for scroll-spy). Adopt on every long admin form; the next surface-tint decision is then ONE file, not an 11-stylesheet sweep. 2026-08-26 (adoption sweep): the last per-screen tinted-surface classes — ledger/lookups/meetings/scoutbook-export/calendar/workbench/events/photo-albums — moved onto FormPanel/FormSection and were deleted from their stylesheets; finance's .formPanel was already-dead CSS, removed outright; media-picker's .panel is a display:none tab toggle, not a form surface, and stays as-is."
          >
            <FormPanel title="Logistics" note="Where and when, for the public page." actions={<Button variant="primary" size="sm">Saved</Button>}>
              <label className="adminLabel">
                Location
                <input defaultValue="Northwoods" />
              </label>
            </FormPanel>
            <FormSection num={2} title="Contact" actions={<Button size="sm">Edit</Button>}>
              <label className="adminLabel">
                Email
                <input defaultValue="troop@example.org" />
              </label>
            </FormSection>
          </Specimen>
          <Specimen
            label="Card"
            canonical
            note="Gray-200 border, var(--admin-radius), shadow-sm. The .panel classes keep their names but carry these values now. Background: --admin-white for a display card, --admin-form-bg when the panel holds fields."
          >
            <div className={util.card} style={{ width: '100%' }}>
              <div className={util.cardSoon}>Card content</div>
            </div>
          </Specimen>
          <Specimen
            label="Blocks row — three-way mode (.modeRow, signup builder)"
            note="A .toggleRow whose control is a radio group instead of one checkbox (Guests: none / count / named — Plans/Guests-As-People.md, 2026-08-23). Same rhythm and rule as its checkbox siblings; the hint under the choices changes with the choice, and an optional field (.modeField) can hang under it. Reach for this only when a block genuinely has three states — a two-state block stays a Toggle."
          >
            <fieldset className={ev.modeRow}>
              <legend>Guests</legend>
              <div className={ev.modeChoices} role="radiogroup" aria-label="Guest mode (specimen)">
                <label className={ev.modeChoice}><input type="radio" name="sg-guest-mode" readOnly /> No guests</label>
                <label className={ev.modeChoice}><input type="radio" name="sg-guest-mode" defaultChecked readOnly /> Count only</label>
                <label className={ev.modeChoice}><input type="radio" name="sg-guest-mode" readOnly /> Named guests</label>
              </div>
              <span className={ev.toggleHint}>Families give a number (&ldquo;+3 guests&rdquo;) on their signup — a Court of Honor, a service project.</span>
            </fieldset>
          </Specimen>
        </div>
      </section>

      {/* ════ ASSIGNMENT BOARD ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Assignment Board</h2>
        <p className={sg.sectionNote}>
          Added 2026-08-22 (Plans/Event-Logistics.md): the Rides &amp; assignments board at
          /admin/rosters/[id]/assignments — cars, tents, patrols, teams. A column per group is a
          <code>.card</code> (drop target, <code>data-over</code> while a chip hovers,
          <code>data-full</code> top accent at capacity); the unassigned pool is
          <code>.card.pool</code> (form-bg, dashed). People are <code>.chip</code>s — draggable, with
          the Move… <code>.moveSelect</code> as the touch/keyboard path. The capacity pill counts the
          driver for cars (seats include the driver).
        </p>
        <div className={sg.specimenGrid}>
          <Specimen label="Group card" canonical note="Driver (or group name) + sub line, capacity pill: open = forest, full = danger. Chips carry the class Badge and a Move… select.">
            <div className={board.card} style={{ width: '100%' }}>
              <div className={board.cardHead}>
                <span className={board.cardTitle}>
                  Jason Porter
                  <span className={board.cardSub}>pulling trailer</span>
                </span>
                <span className={`${board.capPill} ${board.capOpen}`}>2 of 4 · 2 open</span>
              </div>
              <ul className={board.chips}>
                <li className={board.chip}>
                  <span className={board.chipName}>Jason Porter</span>
                  <span className={board.chipRole}>driver</span>
                </li>
                <li className={board.chip}>
                  <span className={board.chipName}>Anjali Sankpal-Tatera</span>
                  <Badge variant="muted">Scout</Badge>
                  <select className={board.moveSelect} aria-label="Move (specimen)" defaultValue="1">
                    <option value="1">Jason Porter (2/4)</option>
                  </select>
                  <button type="button" className={board.chipX} aria-label="Remove (specimen)">×</button>
                </li>
              </ul>
            </div>
          </Specimen>
          <Specimen label="Pool + full card" note="The unassigned pool is dashed on form-bg; a full card carries the warning top accent and a danger pill.">
            <div className={`${board.card} ${board.pool}`} style={{ width: '100%' }}>
              <div className={board.cardHead}>
                <span className={board.cardTitle}>Needs a ride</span>
                <span className={board.capPill}>1</span>
              </div>
              <ul className={board.chips}>
                <li className={board.chip}>
                  <span className={board.chipName}>Owen Radtke</span>
                  <Badge variant="muted">Scout</Badge>
                </li>
              </ul>
            </div>
            <div className={board.card} data-full="true" style={{ width: '100%' }}>
              <div className={board.cardHead}>
                <span className={board.cardTitle}>Tent A</span>
                <span className={`${board.capPill} ${board.capFull}`}>Full · 2 of 2</span>
              </div>
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
          backdrop-click close. Phase C closed the library quick-add exception, and the
          tail session (2026-08-21) closed the last two: fast-entry&rsquo;s MB focus modal
          rides the new <code>closeOnBackdrop=&#123;false&#125;</code> +{' '}
          <code>onBackdropAttempt</code> props (its unsaved-ticks guard is the exemplar —
          backdrop and Esc both route through the consumer&rsquo;s own close decision), and
          media-picker&rsquo;s custom div overlay became a native Dialog (nested pickers
          stack via the platform top layer; Esc closes only the topmost). ZERO non-Dialog
          modals remain in the admin.
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
        <div className={`${sg.specimenLabel} ${sg.specimenLabelApproved}`}>✓ Message Editor (2026-08-25)</div>
        <p className={sg.sectionNote}>
          One shared editor for every email template (<code>_components/message-editor-dialog</code>,
          Plans/Signup-Confirmation-Email.md): Subject (single line), the Message as <strong>markdown</strong> on
          the news editor&rsquo;s <code>MarkdownSource</code> (cheat sheet, a toolbar strip of quiet merge-field
          buttons from the template kind&rsquo;s registry in <code>lib/email-templates</code> that insert{' '}
          <code>[token]</code> inline at the caret, and a &ldquo;Show the summary layout&rdquo; helper that drops
          the editable Going / Guests / Days… block in), and a Preview that is the <strong>real email</strong>:
          <code>lib/email-markdown</code>&rsquo;s inline-styled HTML in a white mail-client frame, with a Plain-text
          toggle for the twin that goes out alongside it. Preview as the sample family (the event&rsquo;s real
          logistics) or, in the builder, any household that has signed up — stacked on phones, side by side
          &ge; 900px. Save message / Discard per the Save standard; Cancel closes. Used by Lookups &amp; Admin
          &rarr; Email templates (with a Name field) and the signup builder&rsquo;s Customize for this event…
        </p>
        <div className={`${dlg.dialog} ${me.wide} ${sg.dialogStatic}`}>
          <div className={dlg.header}>
            <h3 className={dlg.title}>Customize the family receipt</h3>
            <p className={dlg.sub}>Signup — family receipt · fields in [brackets] fill in when the email is sent</p>
          </div>
          <div className={dlg.body}>
            <div className={me.split}>
              <div className={me.editor}>
                <label className={me.field}>
                  <span className={`adminLabel ${me.label}`}>Subject</span>
                  <input type="text" defaultValue="Signed up: [event]" readOnly />
                </label>
                <div className={me.tokens}>
                  {['event', 'date', 'location', 'amount_due', 'summary'].map((t) => (
                    <Button key={t} variant="quiet" size="sm">[{t}]</Button>
                  ))}
                </div>
                <label className={me.field}>
                  <span className={`adminLabel ${me.label}`}>Message</span>
                  <textarea rows={4} readOnly defaultValue={"Hi [name] — you're signed up for **[event]** on [date].\n\n[summary]"} />
                </label>
              </div>
              <aside className={me.preview}>
                <div className={me.previewHead}>
                  <span className={`adminLabel ${me.label}`}>Preview</span>
                  <button type="button" className={me.textToggle}>Plain-text</button>
                </div>
                <div className={me.emailFrame}>
                  <div className={me.emailHtml}>
                    <strong className={me.previewSubject}>Signed up: Fall Campout</strong>
                    <p>Hi Dana Bieser — you&rsquo;re signed up for <strong>Fall Campout</strong> on Oct 9–11, 2026.</p>
                    <p><strong>Going</strong></p>
                    <ul className={me.previewList}>
                      <li>Avery Scout</li>
                      <li>Dana Bieser</li>
                    </ul>
                    <p><strong>Amount due:</strong> $75.00</p>
                  </div>
                </div>
              </aside>
            </div>
          </div>
          <div className={dlg.actions}>
            <Button variant="secondary">Cancel</Button>
            <Button variant="secondary" disabled>Discard changes</Button>
            <Button variant="primary" disabled>Saved</Button>
          </div>
        </div>
      </section>

      {/* ════ DATES ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Dates</h2>
        <p className={sg.sectionNote}>
          <strong>✓ Canonical — date display standard, <code>lib/format-date</code>.</strong>{' '}
          Patrick, 2026-08-24, after a sweep found 21 visible formats, 36 raw &lsquo;2026-07-12&rsquo;
          renders, four slash variants and a handful of genuine wrong-day bugs: ONE Central-pinned
          module. A <code>date</code> column (&lsquo;YYYY-MM-DD&rsquo;) is a calendar day and is never
          fed to <code>new Date()</code> as an instant (UTC midnight = the evening before in
          Milwaukee); a timestamptz is always rendered in America/Chicago. <code>fmtDate</code> is
          the default for every table, list, hint and dialog. ISO is for data only — exports, URL
          params, picker values, the calendar-import preview. Slash forms are retired.{' '}
          <code>toLocaleDateString</code> / <code>.slice(0, 10)</code> outside{' '}
          <code>lib/format-date</code> are lint errors.
        </p>
        <div className={sg.tableWrap}>
          <table className={`${sg.scoreTable} ${sg.dateTable}`}>
            <thead>
              <tr>
                <th>Helper</th>
                <th>Use for</th>
                <th>Example output</th>
                <th>Input kind</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>fmtDate</code></td>
                <td>
                  The default — tables, lists, hints, dialogs. <code>{'{ year: false }'}</code>{' '}
                  inside a one-year list.
                </td>
                <td>
                  {fmtDate('2026-07-12')}
                  <span className={sg.dateAlt}>{fmtDate('2026-07-12', { year: false })} (year: false)</span>
                </td>
                <td>date column</td>
              </tr>
              <tr>
                <td><code>fmtDateLong</code></td>
                <td>Public prose, bylines, print headers.</td>
                <td>{fmtDateLong('2026-07-12')}</td>
                <td>date column</td>
              </tr>
              <tr>
                <td><code>fmtDateFull</code></td>
                <td>Headings where the weekday matters.</td>
                <td>{fmtDateFull('2026-07-12')}</td>
                <td>date column</td>
              </tr>
              <tr>
                <td><code>fmtDay</code></td>
                <td>Dense day headings, deadlines, job boards.</td>
                <td>{fmtDay('2026-07-12')}</td>
                <td>date column</td>
              </tr>
              <tr>
                <td><code>fmtDateTime</code></td>
                <td>
                  Any timestamp shown with its time; <code>{'{ zone: true }'}</code> in email.
                </td>
                <td>
                  {fmtDateTime('2026-07-12T20:04:00.000Z')}
                  <span className={sg.dateAlt}>{fmtDateTime('2026-07-12T20:04:00.000Z', { zone: true })} (zone: true)</span>
                </td>
                <td>timestamptz (America/Chicago)</td>
              </tr>
              <tr>
                <td><code>fmtMonthYear</code></td>
                <td>Almanacs, &ldquo;updated&rdquo;, &ldquo;earned&rdquo; badges.</td>
                <td>{fmtMonthYear('2026-07-12')}</td>
                <td>date column</td>
              </tr>
              <tr>
                <td><code>fmtRange</code></td>
                <td>Multi-day events, report ranges.</td>
                <td>
                  {fmtRange('2026-07-12', '2026-07-14')}
                  <span className={sg.dateAlt}>{fmtRange('2026-07-30', '2026-08-02')} (spans a month)</span>
                </td>
                <td>date columns (start, end)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ════ SAVE BUTTONS ════ */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Save Buttons</h2>
        <div className={sg.specimenGrid}>
          <Specimen
            label="Save standard — shared SaveButton + useSavedSnapshot + SaveFeedback"
            canonical
            note="Patrick's rule (2026-08-23, rolled out across the workstation 2026-08-24): every Save on an already-saved thing is DISABLED until the draft differs from what is saved, reads “Saved” when clean and “Save changes” when dirty (a first-ever save keeps its own verb, e.g. Add Entry), shows “Saving changes…” the moment it submits and a brief “Done” when it lands, is greyed — never hidden — when it would do nothing, and (2026-08-24, Patrick) has a Discard changes beside it that returns the form to the LAST SAVED state; dialogs and inline row editors satisfy that with Cancel. Import from _components/save-state; pass the screen's own primary class so behaviour is shared and paint stays local. Public twin: events/[id]/save-feedback.tsx (no cross-firewall import)."
          >
            <SaveDemo />
          </Specimen>
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
              admin styles. Phase C took the count to zero; the one sanctioned exception is
              the <code>--admin-preview-*</code> alias block for WYSIWYG preview surfaces.
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
