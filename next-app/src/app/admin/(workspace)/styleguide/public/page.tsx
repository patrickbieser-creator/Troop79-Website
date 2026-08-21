/**
 * /admin/styleguide/public — the PUBLIC site's pattern library and
 * remediation tracker (Plans/Public-Design-System.md, 2026-08-21). Reached
 * via the /admin/styleguide chooser, beside the admin guide.
 *
 * Same two jobs as the admin guide:
 *   1. REFERENCE — canonical public patterns rendered from the REAL public
 *      stylesheets (library.module.css is the promoted canon for shell, form
 *      kit, buttons, empty states — audit 2026-08-21). Because samples share
 *      the live stylesheets, this page cannot drift from what ships.
 *   2. TRACKER — the scoreboard lists every duplication family the audit
 *      found; rows get struck as Phases A–D retire them. Variant notes name
 *      the divergent classes/files still in the wild.
 *
 * Specimens render inside .publicContext (cream paper, Lora) so they look as
 * they do on the public site; the page's own chrome is admin-tokened. Public
 * tokens live on :root (globals.css) so they resolve here too.
 *
 * No page-level capability guard, deliberately — same rationale as the
 * chooser and the admin guide: static samples, no data, no writes.
 */
import { PageTitle } from '../../_components/page-title';
import sg from './public-styleguide.module.css';
import lib from '@/app/(public)/library/library.module.css';

export const metadata = {
  title: 'Public Styleguide — Troop 79'
};

/* ── Token data (names + reference values; chips read the live var() so a
      globals.css change updates here automatically) ── */

const PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['--navy', '#1e3a4a'],
  ['--navy-mid', '#2a4f63'],
  ['--navy-light', '#3a6478'],
  ['--navy-hover', '#163040'],
  ['--forest', '#3d5a3e'],
  ['--forest-light', '#527554'],
  ['--khaki', '#c4a882'],
  ['--khaki-light', '#ddd0bb'],
  ['--bark', '#8b6914'],
  ['--bark-light', '#a98020'],
  ['--cream', '#faf6ef'],
  ['--newsprint', '#f4efe6'],
  ['--warm-white', '#ffffff'],
  ['--text-head', '#1a1a1a'],
  ['--text-body', '#363636'],
  ['--text-meta', '#787060'],
  ['--border-light', '#e2d9cc'],
  ['--border-mid', '#c8bfaf'],
  ['--rule', '#e4d9c4']
];

const TYPE_SCALE: ReadonlyArray<readonly [string, string]> = [
  ['--fs-2xs', '11px'],
  ['--fs-xs', '12px'],
  ['--fs-sm', '13px'],
  ['--fs-md', '15px'],
  ['--fs-lg', '17px'],
  ['--fs-xl', '20px'],
  ['--fs-2xl', '26px'],
  ['--fs-3xl', '34px'],
  ['--fs-display', 'clamp(30px, 6vw, 44px)']
];

const SPACE_SCALE: ReadonlyArray<readonly [string, string]> = [
  ['--sp-1', '4px'],
  ['--sp-2', '8px'],
  ['--sp-3', '12px'],
  ['--sp-4', '16px'],
  ['--sp-5', '20px'],
  ['--sp-6', '24px'],
  ['--sp-7', '28px'],
  ['--sp-8', '32px'],
  ['--sp-9', '40px'],
  ['--sp-10', '48px'],
  ['--sp-11', '56px'],
  ['--sp-12', '64px']
];

const RADII: ReadonlyArray<readonly [string, string]> = [
  ['--rad-sm', '2px'],
  ['--rad-md', '4px'],
  ['--rad-lg', '8px'],
  ['--rad-pill', '999px'],
  ['--rad-circle', '50%']
];

const STATUS: ReadonlyArray<readonly [string, string, string]> = [
  ['danger', '--status-danger', '--status-danger-bg'],
  ['success', '--status-success', '--status-success-bg'],
  ['warning', '--status-warning', '--status-warning-bg'],
  ['info', '--status-info', '--status-info-bg']
];

/* ── Scoreboard — the remediation work queue (audit 2026-08-21). A row is
      struck when its family is fully served by a shared component / token
      and the divergent copies are deleted. ── */

const SCOREBOARD: ReadonlyArray<readonly [string, string, string]> = [
  ['Page header / masthead', '11 files re-declare + 2 pages inline', 'PageHeader (Phase A)'],
  ['Page shell (1180px)', '17 CSS copies + 4 inline', 'PageShell (Phase A)'],
  ['Buttons', '33 distinct class names / 15 files; primary green written 5× with 3 greens, 3 radii', 'Button (Phase A)'],
  ['Pills / badges / tags', '46 distinct class names / 16 files', 'Badge (Phase A)'],
  ['Form fields', '18 files / 88 declarations', 'Form kit (Phase A)'],
  ['Cards', '~14 hand-written surface recipes / 4 radii', '.card primitive (Phase A)'],
  ['Tab strips', '5 files / 27 declarations', 'TabStrip (Phase A)'],
  ['Notices / errors', '15 files / 34 declarations; 13 reds, no danger token', 'Notice (Phase A)'],
  ['Empty states', '12 files / 20 declarations', 'EmptyState (Phase A)'],
  ['Section dividers', 'library sectionDivider replicated as headRule/spanBar + inline', 'SectionDivider (Phase A)'],
  ['Stylesheet-less screens', 'merit-badges ×2 (46 inline sites), site-footer (no media queries)', 'Phase B'],
  ['Inline styles', '146 sites / 31 files (~140 convertible)', 'Phase B target ≤ 15'],
  ['Second-lineage palette', '8 files render an alternate palette (second navy #22333b, five meta-greys…)', 'Phase C'],
  ['Hex census', '79 distinct hex across public modules', 'Phase C target ≤ 30']
];

export default function PublicStyleguidePage() {
  return (
    <>
      <PageTitle
        title="Public Styleguide"
        sub={
          <>
            The canonical version of every recurring public-site pattern, rendered from the
            live production stylesheets &mdash; plus the drift the 2026-08-21 audit found,
            tracked in the scoreboard until Phases A&ndash;D retire it. Before styling a
            public screen, find the pattern here and import it. Plan:{' '}
            <code>Plans/Public-Design-System.md</code>.
          </>
        }
      />

      {/* ── Palette ── */}
      <section className={sg.section}>
        <h2 className={sg.sectionLabel}>Palette</h2>
        <p className={sg.sectionNote}>
          The NYT-style editorial palette, on <code>:root</code> in <code>globals.css</code>.
          Unprefixed names are the public namespace; admin styles must never read them
          (the sanctioned exceptions are listed under Shared contracts below).
        </p>
        <div className={sg.swatchGrid}>
          {PALETTE.map(([name, val]) => (
            <div key={name} className={sg.swatch}>
              <div className={sg.swatchChip} style={{ background: `var(${name})` }} />
              <div className={sg.swatchName}>{name}</div>
              <div className={sg.swatchVal}>{val}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Status ── */}
      <section className={sg.section}>
        <h2 className={sg.sectionLabel}>Status</h2>
        <p className={sg.sectionNote}>
          New in Phase 0 &mdash; the public side previously had <strong>no danger token at
          all</strong> (13 distinct reds in the wild). Danger canon is <code>#8c3b3b</code>{' '}
          (decided 2026-08-21); success reuses <code>--forest</code>, warning reuses{' '}
          <code>--bark</code>, info reuses <code>--navy</code>.
        </p>
        <div>
          {STATUS.map(([tone, fg, bg]) => (
            <span
              key={tone}
              className={sg.statusChip}
              style={{ color: `var(${fg})`, background: `var(${bg})` }}
            >
              {tone} &mdash; <code>{fg}</code> on <code>{bg}</code>
            </span>
          ))}
        </div>
      </section>

      {/* ── Type scale ── */}
      <section className={sg.section}>
        <h2 className={sg.sectionLabel}>Type scale</h2>
        <p className={sg.sectionNote}>
          Nine steps replacing the 59 distinct font sizes (px, rem and em) the audit found.
          <code>--fs-display</code> collapses the three near-identical <code>clamp()</code>{' '}
          headline curves. Faces: <code>--font-display</code> (Playfair Display),{' '}
          <code>--font-body</code> (Lora), <code>--font-ui</code> (Open Sans),{' '}
          <code>--font-mono</code> &mdash; all defined on <code>:root</code> and served via{' '}
          <code>next/font</code>.
        </p>
        <div className={sg.publicContext}>
          {TYPE_SCALE.map(([name, val]) => (
            <div key={name} className={sg.typeRow}>
              <span className={sg.typeName}>
                {name} &middot; {val}
              </span>
              <span style={{ fontSize: `var(${name})` }}>
                Scouting builds character &mdash; Troop 79, Milwaukee
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Spacing ── */}
      <section className={sg.section}>
        <h2 className={sg.sectionLabel}>Spacing (4px grid)</h2>
        <div>
          {SPACE_SCALE.map(([name, val]) => (
            <div key={name} className={sg.spaceRow}>
              <span className={sg.typeName}>
                {name} &middot; {val}
              </span>
              <div className={sg.spaceBar} style={{ width: `var(${name})` }} />
            </div>
          ))}
        </div>
      </section>

      {/* ── Radii ── */}
      <section className={sg.section}>
        <h2 className={sg.sectionLabel}>Radii</h2>
        <p className={sg.sectionNote}>
          2px is the small canon, 4px medium, 8px large; 3px is retired (each use folds to
          its nearer neighbor &mdash; decided 2026-08-21).
        </p>
        <div className={sg.radRow}>
          {RADII.map(([name, val]) => (
            <div key={name} className={sg.radBox} style={{ borderRadius: `var(${name})` }}>
              {name.replace('--rad-', '')} {val}
            </div>
          ))}
        </div>
      </section>

      {/* ── Scoreboard ── */}
      <section className={sg.section}>
        <h2 className={sg.sectionLabel}>Scoreboard — drift remediation queue</h2>
        <p className={sg.sectionNote}>
          One row per duplication family from the 2026-08-21 audit. A row is struck when the
          shared component (or token scale) serves every occurrence and the divergent copies
          are deleted. An un-updated scoreboard lies &mdash; keep it in the same commit as
          the change.
        </p>
        <table className={sg.scoreTable}>
          <thead>
            <tr>
              <th>Family</th>
              <th>Drift at audit</th>
              <th>Resolution</th>
            </tr>
          </thead>
          <tbody>
            {SCOREBOARD.map(([family, drift, res]) => (
              <tr key={family}>
                <td>{family}</td>
                <td>{drift}</td>
                <td>{res}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Canonical specimens ── */}
      <section className={sg.section}>
        <h2 className={sg.sectionLabel}>Canonical specimens</h2>
        <p className={sg.sectionNote}>
          Rendered from <code>library.module.css</code> &mdash; the de-facto public canon
          the audit identified (19 importers; its shell and form clusters are promoted to
          shared components in Phase A). These samples share the live stylesheet, so they
          cannot drift.
        </p>

        <div className={sg.publicContext}>
          {/* Page header */}
          <div className={sg.specimenBlock}>
            <header className={lib.pageHeader}>
              <p className={lib.kicker}>
                Troop 79 <span className={lib.kickerSep}>&bull;</span> Resource Library
              </p>
              <h1 className={lib.pageTitle}>Page Header Specimen</h1>
              <p className={lib.pageLede}>
                Kicker, display title, lede, and the hairline rule &mdash; the shell every
                public page re-declares today and PageHeader replaces in Phase A.
              </p>
              <div className={lib.headRule} />
            </header>
          </div>

          {/* Buttons */}
          <div className={sg.specimenBlock}>
            <button type="button" className={lib.btnPrimary}>
              Primary action
            </button>{' '}
            <button type="button" className={lib.btnSecondary}>
              Secondary action
            </button>
          </div>

          {/* Form kit */}
          <div className={sg.specimenBlock}>
            <div className={lib.formCard}>
              <div className={lib.fieldRow}>
                <label className={lib.fieldLabel} htmlFor="sg-pub-name">
                  Scout name
                </label>
                <input
                  id="sg-pub-name"
                  className={lib.textInput}
                  defaultValue="Sample value"
                />
                <p className={lib.fieldHint}>Hint text — quiet, meta-toned.</p>
                <p className={lib.fieldError}>Error text — the field kit&rsquo;s red.</p>
              </div>
            </div>
          </div>

          {/* Empty state + tag */}
          <div className={sg.specimenBlock}>
            <div className={lib.emptyState}>Nothing here yet — the empty-state canon.</div>
            <p style={{ marginTop: 12 }}>
              <span className={lib.reqTag}>1a</span> <span className={lib.reqTag}>2</span>{' '}
              requirement tags — the badge seed.
            </p>
          </div>
        </div>

        <div className={sg.variantNote}>
          <strong>Variants in the wild</strong> (deleted as Phase A adoption lands) &mdash;
          Page header: <code>.pageHeader</code> re-declared in advancement, meeting-agenda,
          meeting-plan, photos; <code>.title</code> in event-detail, profile; both
          merit-badges pages inline. Buttons: <code>.submitBtn</code> ×3 files,{' '}
          <code>.signInBtn</code>, <code>.gateBtn</code>, <code>.subscribeBtn</code>,{' '}
          <code>.passkeyBtn</code>, <code>.editSaveBtn</code>, <code>.pagerBtn</code>,{' '}
          <code>.monthNavBtn</code>&hellip; (33 names / 15 files). Form fields:{' '}
          <code>.editLabel</code>/<code>.gateLabel</code>/<code>.noteLabel</code>,{' '}
          <code>.editInput</code>/<code>.gateInput</code>/<code>.filterInput</code>&hellip;
          (18 files). Tabs: <code>.viewTabs</code> (advancement/report, the canon-to-be),{' '}
          <code>.viewToggleRow</code> (events), <code>.seg</code> (event-detail),{' '}
          <code>.tabs</code> (meeting-plan, scout-account). Badges: 46 names incl.{' '}
          <code>.catTag</code>, <code>.tagChip</code>, <code>.statusTag</code>,{' '}
          <code>.chip</code>, <code>.rankPill</code>, <code>.trackBadge</code>&hellip;
          Empty states: <code>.empty</code>, <code>.emptyRow</code>, <code>.miniEmpty</code>,{' '}
          <code>.recapEmpty</code>&hellip; (12 files).
        </div>
      </section>

      {/* ── Shared contracts ── */}
      <section className={sg.section}>
        <h2 className={sg.sectionLabel}>Shared contracts (frozen)</h2>
        <div className={sg.contractCard}>
          <strong>Article prose tokens — </strong>
          <code>--article-body-size</code>, <code>--article-h2-size</code>,{' '}
          <code>--article-h3-size</code>, <code>--article-line-height</code>,{' '}
          <code>--article-measure</code>, <code>--article-block-space</code>,{' '}
          <code>--article-list-item-space</code>, <code>--article-list-marker</code>. A
          third namespace owned by neither side: DB-driven (edited in Lookups &amp; Admin),
          injected at <code>:root</code> by both layouts, consumed by 7 public + 8 admin
          files via <code>src/lib/article-body/</code>. Neither design system folds these
          in; restyling prose means editing the DB values, and it restyles both sides.
        </div>
        <div className={sg.contractCard}>
          <strong>Admin preview aliases — </strong>the only sanctioned admin&rarr;public
          token reads. <code>admin.css</code>&rsquo;s <code>--admin-preview-*</code> block
          aliases 8 public tokens (<code>--font-display</code>, <code>--font-body</code>,{' '}
          <code>--cream</code>, <code>--newsprint</code>, <code>--text-body</code>,{' '}
          <code>--text-head</code>, <code>--text-meta</code>, <code>--border-light</code>)
          so admin WYSIWYG panes preview public output faithfully. Changing any of these
          eight values restyles admin preview panes too &mdash; treat them as a contract,
          not private public state.
        </div>
      </section>
    </>
  );
}
