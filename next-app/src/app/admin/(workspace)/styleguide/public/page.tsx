/**
 * /admin/styleguide/public — the PUBLIC site's pattern library and
 * remediation tracker (Plans/Public-Design-System.md, 2026-08-21). Reached
 * via the /admin/styleguide chooser, beside the admin guide.
 *
 * Same two jobs as the admin guide:
 *   1. REFERENCE — canonical public patterns rendered from the LIVE shared
 *      components in src/app/_components/ (promoted in Phase A from the
 *      library.module.css / advancement-report canon the audit identified).
 *      Because samples render the real components, this page cannot drift
 *      from what ships.
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
import { PageHeader, KickerSep } from '@/app/_components/page-header';
import { Button } from '@/app/_components/button';
import { Badge } from '@/app/_components/badge';
import { Notice } from '@/app/_components/notice';
import { EmptyState } from '@/app/_components/empty-state';
import { SectionDivider } from '@/app/_components/section-divider';
import { PublicTabStripSpecimen } from './specimens';
import { FormCard, Field, TextInput } from '@/app/_components/form';
import { DateField } from '@/app/_components/date-field';

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
  [
    'Page header / masthead',
    '11 files re-declare + 2 pages inline',
    'PageHeader SHIPPED (A) — sanctioned local headers: photos + events index (genuine two-column layouts), event-detail/profile (kind-chip eyebrow / narrow scale; type sizes on canon since C), meeting-plan meta row (needs a meta slot)'
  ],
  [
    'Page shell (1180px)',
    '17 CSS copies + 4 inline',
    'PageShell SHIPPED (A) — residuals: photos, event-detail, scout-detail, merit-badges inline (B)'
  ],
  [
    'Buttons',
    '33 distinct class names / 15 files; primary green written 5× with 3 greens, 3 radii',
    'Button SHIPPED (A; size="sm" + dangerGhost added C) — submitBtn, passkeyRemove, mastheadJoin converted; /signin passkey CTA is primary (full-width) only on a browser with the remembered-device hint cookie, else the shared ghost variant at the bottom (2026-08-21); sanctioned locals: signOutBtn (forest outline), scout-account proxy (compact navy), about-join khaki CTA, calendar/pager chrome'
  ],
  [
    'Pills / badges / tags',
    '46 distinct class names / 16 files',
    'Badge SHIPPED (A; caps={false} added C) — reqDoneBadge converted, class deleted; CATEGORICAL tags stay by rule. ONE taxonomy (2026-08-21, Patrick): news articles join calendar_categories (article_categories) — article and event cards both chip their category via articleCategoryLabel/.catEvents; the home "Browse by Category" cloud (loadCategoryCloud, live counts, .tagCount) and /category/<slug> (events + news + resources) read the same list'
  ],
  [
    'Form fields',
    '18 files / 88 declarations',
    'Form kit SHIPPED (A; 16px iOS floor decided C) — profile editors decoupled onto the public DateField (admin imports in public: ZERO); event sign-up forms gained named guest rows (GuestRowsEditor, 2026-08-21: name + class per guest, replacing the "+N guests" count — Plans/Participant-Classification.md; .guestRow/.guestAdd/.guestRemove on tokens in event-detail.module.css); DateField v2 (2026-08-21, Patrick): native input → rich control (tolerant typing via lib/date-entry + react-day-picker popover on public tokens — admin parity by behavior, not by import); sanctioned locals: name-search (hint-above layout), tagSelect (compact header control)'
  ],
  [
    'Cards',
    '~14 hand-written surface recipes / 4 radii',
    '.card SHIPPED (A) — member/reimbursement surfaces converted; content-card recipes (resourceCard, storyCard…) remain, fold in Phase C'
  ],
  [
    'Tab strips',
    '5 files / 27 declarations',
    'TabStrip SHIPPED (A) — report (canon) + events List/Month converted, CSS deleted; event-detail .seg is an RSVP INPUT control, not tabs (stays by design)'
  ],
  [
    'Notices / errors',
    '15 files / 34 declarations; 13 reds, no danger token',
    'Notice SHIPPED (A) — 24+ sites on the status tokens (gateErr, savedNote, fieldError boxes, proxyBanner)'
  ],
  [
    'Empty states',
    '12 files / 20 declarations',
    'EmptyState SHIPPED (A) — 10+ sites; residuals: home/news .empty (borderless editorial variant), photos rich empty block'
  ],
  [
    'Section dividers',
    'library sectionDivider replicated as headRule/spanBar + inline',
    'SectionDivider SHIPPED (A) — home/about/join editorial variant FOLDED (C, Patrick call); one sanctioned local: the printed Clipboard (print-load-bearing + meta slot)'
  ],
  [
    'Stylesheet-less screens',
    'merit-badges ×2 (46 inline sites), site-footer (no media queries)',
    'STRUCK (B) — merit-badges.module.css + site-footer.module.css + signed-in-as shipped; footer gained its first mobile stacking (640px); zero stylesheet-less screens remain'
  ],
  [
    'Inline styles',
    '146 sites / 31 files (~140 convertible)',
    'STRUCK (B) — 13 survivors in 6 files, every one genuinely dynamic and commented (category colors, --month-lanes/--lane-count, fill %, tree-depth indents)'
  ],
  [
    'Second-lineage palette',
    '8 files render an alternate palette (second navy #22333b, five meta-greys…)',
    'STRUCK (C) — canonical palette everywhere; rem font sizes folded onto --fs-*; on-navy alphas onto --on-navy-*; zero raw hex in the 8 files'
  ],
  [
    'Hex census',
    '79 distinct hex across public modules',
    'STRUCK (C) — 7 distinct remain, every one commented deliberate: Clipboard pencil-grid print fidelity (#999/#aaa/#efeae0), categorical ramps (#7a7068, #f5eeda), merit-badge celebration gold (#f5d76a/#5a3a00 — mint --award-gold on a 3rd use)'
  ]
];

export default function PublicStyleguidePage() {
  return (
    <>
      <PageTitle
        title="Public Styleguide"
        sub={
          <>
            The canonical version of every recurring public-site pattern, rendered live from
            the shared components. The 2026-08-21 remediation (Phases 0&ndash;D, v1.63&ndash;
            v1.67) is COMPLETE &mdash; the scoreboard below records what each family
            resolved to and the named sanctioned locals that remain. Before styling a public
            screen, find the pattern here and import it. History:{' '}
            <code>Plans/Completed/Public-Design-System.md</code>.
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
          Rendered from the SHARED COMPONENTS in <code>src/app/_components/</code> &mdash;
          promoted in Phase A from the de-facto canon (library.module.css&rsquo;s shell and
          form clusters; advancement/report&rsquo;s tabs). These samples render the live
          components, so they cannot drift. Import the component; never re-declare the
          pattern in a screen module.
        </p>

        <div className={sg.publicContext}>
          {/* PageHeader */}
          <div className={sg.specimenBlock}>
            <PageHeader
              kicker={
                <>
                  Troop 79 <KickerSep /> Resource Library
                </>
              }
              title="Page Header Specimen"
              lede="Kicker, display title, lede, and the hairline rule — PageHeader, adopted by 20+ pages in Phase A."
            />
          </div>

          {/* Buttons */}
          <div className={sg.specimenBlock}>
            <Button variant="primary">Primary action</Button>{' '}
            <Button variant="secondary">Secondary action</Button>{' '}
            <Button variant="danger">Withdraw</Button>{' '}
            <Button variant="ghost">Ghost link-button</Button>{' '}
            <Button variant="dangerGhost">Remove</Button>
            <div className={sg.specimenGap} />
            <Button variant="primary" size="sm">
              Compact primary
            </Button>{' '}
            <Button variant="secondary" size="sm">
              Compact secondary
            </Button>{' '}
            <span className={sg.specimenInlineNote}>
              size=&quot;sm&quot; — section-header CTAs and chrome rows (Phase C)
            </span>
          </div>

          {/* TabStrip */}
          <div className={sg.specimenBlock}>
            <PublicTabStripSpecimen />
          </div>

          {/* Badge tones */}
          <div className={sg.specimenBlock}>
            <Badge tone="neutral">Neutral</Badge> <Badge tone="success">Approved</Badge>{' '}
            <Badge tone="warning">Submitted</Badge> <Badge tone="danger">Denied</Badge>{' '}
            <Badge tone="info">Paid</Badge> <Badge tone="accent">Your scout</Badge>{' '}
            <Badge tone="accent" caps={false}>
              ✓ Completed Mar 2026
            </Badge>{' '}
            <span className={sg.specimenInlineNote}>
              caps=&#123;false&#125; — mixed-case content (dates, names)
            </span>
          </div>

          {/* Notices */}
          <div className={sg.specimenBlock}>
            <Notice tone="error">Error notice — role=&quot;alert&quot;, status-danger tokens.</Notice>
            <div className={sg.specimenGap} />
            <Notice tone="success">Success notice — role=&quot;status&quot;.</Notice>
            <div className={sg.specimenGap} />
            <Notice tone="warning">Warning notice — khaki/bark family.</Notice>
            <div className={sg.specimenGap} />
            <Notice tone="info">Info notice — navy family.</Notice>
          </div>

          {/* Form kit */}
          <div className={sg.specimenBlock}>
            <FormCard>
              <Field label="Scout name" error="Error text — the status-danger red.">
                <TextInput defaultValue="Sample value" readOnly />
              </Field>
              <Field
                label="Date of birth"
                hint="Rich public DateField (2026-08-21, replaces the Phase C native input): type any form — 7/25/26, Jul 25 2026, 20260725, today — or pick from the calendar (month/year dropdowns, Clear/Today; centered sheet ≤640px). Parsing lives in lib/date-entry; no admin code. 16px iOS floor."
              >
                <DateField defaultValue="2012-04-01" />
              </Field>
            </FormCard>
          </div>

          {/* SectionDivider + EmptyState + reqTag */}
          <div className={sg.specimenBlock}>
            <SectionDivider label="This Week" link={<a href="#specimen">All news</a>} />
            <EmptyState action={<a href="#specimen">Suggest one</a>}>
              Nothing here yet — the empty-state canon.
            </EmptyState>
            <p className={sg.specimenTagRow}>
              <span className={lib.reqTag}>1a</span> <span className={lib.reqTag}>2</span>{' '}
              requirement tags — library-specific (mono code tags, NOT the Badge pattern).
            </p>
          </div>
        </div>

        <div className={sg.variantNote}>
          <strong>Sanctioned locals after closeout (Phase D, 2026-08-21)</strong> &mdash;
          every remaining divergence is deliberate and documented in its scoreboard row:
          two-column headers (photos, events index), kind-chip/narrow headers
          (event-detail, profile), meeting-plan&rsquo;s meta-row header (wants a PageHeader
          meta slot if a second case appears); <code>.signOutBtn</code> +
          scout-account&rsquo;s compact proxy button + about-join&rsquo;s khaki CTA +
          calendar pager/month chrome; name-search + tagSelect (layout-divergent form
          controls); categorical tags (<code>.catTag</code>, <code>.tagChip</code>,{' '}
          <code>.tagEagle</code>&hellip;) by rule; photos&rsquo; rich empty block; the
          printed Clipboard&rsquo;s divider + pencil-grid greys (print fidelity); the
          celebration-gold award pair (mint <code>--award-gold</code> on a 3rd use); 13
          dynamic inline sites.
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
          <strong>Admin preview aliases — </strong>sanctioned admin&rarr;public token reads.{' '}
          <code>admin.css</code>&rsquo;s <code>--admin-preview-*</code> block aliases 8
          public tokens (<code>--font-display</code>, <code>--font-body</code>,{' '}
          <code>--cream</code>, <code>--newsprint</code>, <code>--text-body</code>,{' '}
          <code>--text-head</code>, <code>--text-meta</code>, <code>--border-light</code>)
          so admin WYSIWYG panes preview public output faithfully. Changing any of these
          eight values restyles admin preview panes too &mdash; treat them as a contract,
          not private public state.
        </div>
        <div className={sg.contractCard}>
          <strong>ScoutAccordion — </strong>the third and last sanctioned crossing.{' '}
          <code>_components/scout-accordion.module.css</code> is styled on the PUBLIC tokens
          but consumed by both the public advancement report and{' '}
          <code>/admin/advancement/report</code> &mdash; deliberately, so the report renders
          identically in both places (same spirit as the preview aliases). The next/font
          variables (<code>--font-playfair</code>/<code>--font-lora</code>/
          <code>--font-open-sans</code>) are infrastructure, not palette &mdash; both sides
          may read them. Everything else is firewalled: zero admin imports in public, zero{' '}
          <code>--admin-*</code> reads in public, zero public-token reads in admin chrome
          (verified Phase D, 2026-08-21).
        </div>
      </section>
    </>
  );
}
