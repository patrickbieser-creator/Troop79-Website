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
import cardS from '@/app/_components/card.module.css';
import { PublicBlockedSaveSpecimen, PublicDietRowsSpecimen, PublicFinishLineSpecimen, PublicAmountScaleSpecimen, PublicGearSpecimen, PublicMenuEditListSpecimen, PublicStepperSpecimen, PublicTabStripSpecimen } from './specimens';
import { IngredientList } from '@/app/(public)/library/menu-monster/_components/ingredient-list';
import { StepStrip } from '@/app/(public)/library/menu-monster/menus/_components/step-strip';
import { SummaryRail } from '@/app/(public)/library/menu-monster/menus/_components/summary-rail';
import { AddRow } from '@/app/(public)/library/menu-monster/_components/add-row';
import menuMonsterS from '@/app/(public)/library/menu-monster/menus/_components/workspace.module.css';
import type { PlanProgress } from '@/lib/menu-monster/menu-view';
import { FormCard, Field, TextInput } from '@/app/_components/form';
import { DateField } from '@/app/_components/date-field';
import { SignInToSignUpPanel } from '@/app/(public)/events/[id]/signup-panels';
import { SignupStatusBar } from '@/app/(public)/events/[id]/signup-status-bar';
import { MbRequirementRows } from '@/app/(public)/library/mb/[mbId]/mb-requirement-rows';
import { MbLegend } from '@/app/(public)/library/mb/[mbId]/mb-legend';

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
    'Button SHIPPED (A; size="sm" + dangerGhost added C; calm R2 2026-10-03: sentence case, 600, 36px / sm 30px) —submitBtn, passkeyRemove, mastheadJoin converted; /signin passkey CTA is primary (full-width) only on a browser with the remembered-device hint cookie, else the shared ghost variant at the bottom (2026-08-21); sanctioned locals: signOutBtn (forest outline), scout-account proxy (compact navy), about-join khaki CTA, calendar/pager chrome'
  ],
  [
    'Pills / badges / tags',
    '46 distinct class names / 16 files',
    'Badge SHIPPED (A; caps={false} added C, removed in calm R1 2026-10-03 — every badge sentence case) —reqDoneBadge converted, class deleted; CATEGORICAL tags stay by rule. ONE taxonomy (2026-08-21, Patrick): news articles join calendar_categories (article_categories) — article and event cards both chip their category via articleCategoryLabel/.catEvents; the home "Browse by Category" cloud (loadCategoryCloud, live counts, .tagCount) and /category/<slug> (events + news + resources) read the same list'
  ],
  [
    'Form fields',
    '18 files / 88 declarations',
    'Form kit SHIPPED (A; 16px iOS floor decided C) — profile editors decoupled onto the public DateField (admin imports in public: ZERO); event sign-up forms gained named guest rows (GuestRowsEditor, 2026-08-21: name + class per guest, replacing the "+N guests" count — Plans/Participant-Classification.md; .guestRow/.guestAdd/.guestRemove on tokens in event-detail.module.css); DateField v2 (2026-08-21, Patrick): native input → rich control (tolerant typing via lib/date-entry + react-day-picker popover on public tokens — admin parity by behavior, not by import); sanctioned locals: name-search (hint-above layout), tagSelect (compact header control); Guests as People (2026-08-23, Plans/Guests-As-People.md): the guest block gained .guestRowAdult (phone column for an adult guest), .guestAgain (the "brought before" picks reuse .pickChip), .guestMatch (typed-name confirm line) and .guestCountRow (count mode: number + note) — all on existing tokens in event-detail.module.css'
  ],
  [
    'Number fields / dialers',
    '3 hand-rolled stepper copies (planner, workspace) + 4 plain number boxes (guest count, days, seats, reimbursement amount)',
    'Stepper SHIPPED (2026-10-02, Calm-Site-Restyle Decisions 1-2) — one shared − n + at 32px/16px; planner, Menu Monster workspace and event sign-up (guests, days, seats) converted, planner .stepper/.stepBtn/.numIn deleted. Reimbursement amount is dollars-and-cents, so it stays a number box (AmountInput, same 32px look) rather than a dial. Menu Monster People/diets now use plain NumberBox (unframed, hairline-wrapped via whos-eating.module.css); Stepper remains for event sign-up (2026-10-07). Menu Monster brand package qty, shopping-row qty and gear counts (public and admin pickers) are plain NumberBox since v1.200.0; Stepper remains for event sign-up (guest-rows, person-first-form).'
  ],
  [
    'Cards',
    '~14 hand-written surface recipes / 4 radii',
    '.card SHIPPED (A) — member/reimbursement surfaces converted; content-card recipes (resourceCard, storyCard…) remain, fold in Phase C. Calm R1 (2026-10-03): .card borderless; .list/.listRow/.listEnd = the Menu Monster tight list card (38px rows) — the recipe R3/R4 screens migrate onto'
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
    'Calm restyle (loud labels, outlines, heavy rules)',
    'Jenna MACRO sweep 2026-10-03: 9 loud-pattern families across ~97 routes / 107 stylesheets (Plans/Completed/Calm-Site-Restyle-Sweep.md)',
    'STRUCK (R1–R7, 2026-10-03) — shared kit, Button, sign-up pulldowns, public screens, Clipboard/MB/advancement, admin kit (labels one size up), admin screens, long tail. tests/calm-style.test.ts locks the WHOLE tree: no uppercase, no wide tracking, no 1.5/2px rules except named data/print/glyph/functional exemptions (codes, date-block months, print sheets, masthead, tab underline, rings, spinners)'
  ],
  [
    'Stylesheet-less screens',
    'merit-badges ×2 (46 inline sites) — RETIRED 2026-08-22, folded into the Library; site-footer (no media queries)',
    'STRUCK (B) — merit-badges.module.css + site-footer.module.css + signed-in-as shipped; footer gained its first mobile stacking (640px); zero stylesheet-less screens remain'
  ],
  [
    'Inline styles',
    '146 sites / 31 files (~140 convertible)',
    'STRUCK (B) — 16 survivors in 6 files, every one genuinely dynamic and commented (category colors, --month-lanes/--lane-count, fill %; +5 in the four photo-library views, 2026-08-22 — DB category colour + proportional bar; the MB tree-depth indents left with the 2026-09-07 Requirements consolidation)'
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

/** A made-up progress for the SummaryRail specimen (a real one comes from planProgress in menu-view.ts). */
const SPECIMEN_PROGRESS: PlanProgress = {
  steps: {
    eating: { done: true, fixes: [] },
    meals: { done: false, fixes: [{ text: '2 meals empty', count: 2, target: { step: 'meals', mealId: 'x' } }] },
    gear: { done: true, fixes: [] },
    shopping: { done: false, fixes: [{ text: '1 not priced', count: 1, target: { step: 'shopping', ingredientId: 'y' } }] }
  },
  headcount: 8,
  diets: [{ key: 'gf', label: 'Gluten-free', count: 2 }],
  total: 24.8,
  perPersonMeal: 3.1,
  budget: 4,
  hasCost: true,
  toFix: 3,
  fixes: [
    { text: '2 meals empty', count: 2, target: { step: 'meals', mealId: 'x' } },
    { text: '1 not priced', count: 1, target: { step: 'shopping', ingredientId: 'y' } }
  ]
};

export default function PublicStyleguidePage() {
  return (
    <>
      <PageTitle
        back={{ label: 'Styleguides', href: '/admin/styleguide' }}
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
              lede="Quiet kicker, display title, plain lede — no header rule since the calm restyle (R1, 2026-10-03)."
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
            <Badge tone="accent">✓ Completed Mar 2026</Badge>{' '}
            <span className={sg.specimenInlineNote}>
              Sentence case, tint only, no outline (calm restyle R1) — the old caps=&#123;false&#125; switch is gone
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

          {/* List card (calm restyle R1) */}
          <div className={sg.specimenBlock}>
            <ul className={cardS.list} aria-label="List card specimen">
              <li className={cardS.listRow}>
                Fall Camporee <span className={cardS.listEnd}>Oct 9</span>
              </li>
              <li className={cardS.listRow}>
                Klondike Derby <span className={cardS.listEnd}>Jan 23</span>
              </li>
              <li className={cardS.listRow}>
                Summer camp <span className={cardS.listEnd}>Jul 11</span>
              </li>
            </ul>
            <div className={sg.specimenGap} />
            <span className={sg.specimenInlineNote}>
              card.module.css .list / .listRow / .listEnd — borderless white list, 38px rows, a fixed right column
            </span>
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

          {/* Stepper — the shared compact dialer */}
          <div className={sg.specimenBlock}>
            <PublicStepperSpecimen />
            <p className={sg.specimenInlineNote}>
              <code>Stepper</code> / <code>NumberBox</code> / <code>AmountInput</code> from <code>_components/stepper</code> &mdash; 32px tall,
              16px number (iOS floor), 28px buttons, commit-on-blur. Label sits left and ends in a colon. Dollars-and-cents is a framed
              AmountInput, not a dial.
            </p>
          </div>

          {/* Menu Monster planner flow (2026-10-06): the step strip and the summary rail, as the scout planner draws them. */}
          <div className={sg.specimenBlock}>
            <StepStrip
              config={{ people: '#', plan: '#', gear: '#', shopping: '#', bought: '#', share: { label: 'Share', href: '#' } }}
              done={{ eating: true, meals: false, gear: true, shopping: false }}
              current="eating"
            />
            <p className={sg.specimenInlineNote}>
              <code>StepStrip</code> from <code>menu-monster/menus/_components/step-strip</code> &mdash; Who&rsquo;s eating &rarr; Meals &rarr; Gear &rarr;
              Shopping, each its own screen (What we bought joins after the outing). Each step is a link to its route, done ones ticked, the current one underlined, none ever
              locked; the strip scrolls sideways on a phone. Share is a quiet action at the end, not a step.
            </p>
          </div>
          <div className={sg.specimenBlock}>
            <SummaryRail progress={SPECIMEN_PROGRESS} hrefs={{ people: '#', plan: '#', gear: '#', shopping: '#' }} unsaved>
              <Button variant="primary">Save changes</Button>
            </SummaryRail>
            <p className={sg.specimenInlineNote}>
              <code>SummaryRail</code> from <code>menu-monster/menus/_components/summary-rail</code> &mdash; one sticky line under the site nav
              (headcount, cost per person per meal, things to fix); tap the text for the bottom sheet. Its right end is the screen&rsquo;s one primary:
              Save while dirty, &ldquo;Next: &hellip;&rdquo; when clean. &ldquo;unsaved&rdquo; shows only when the Plan tab&rsquo;s draft differs from
              what is saved.
            </p>
          </div>
          <div className={sg.specimenBlock}>
            <AddRow
              actions={[
                { id: 'food', label: 'Food', content: <input type="text" className={menuMonsterS.addInput} aria-label="Find a food (specimen)" placeholder="Add to lunch" /> },
                { id: 'gear', label: 'Gear', content: <input type="text" className={menuMonsterS.addInput} aria-label="Find gear (specimen)" placeholder="More gear for this meal" /> }
              ]}
            />
            <p className={sg.specimenInlineNote}>
              <code>AddRow</code> from <code>menu-monster/_components/add-row</code> &mdash; add rows: one per container, links at rest, search on tap,
              Cancel always visible; a single food has no + Ingredient. Sites: meal panel (+ Food / + Gear), ingredient lists (+ Ingredient), Gear tab (+ Gear), Who&rsquo;s eating (+ Diet), Ingredients tab (+ Ingredient, whose form keeps its own Cancel). Admin twin: <code>AdminAddRow</code>. Cancel and Esc (nothing typed) close it and return focus to the link; the
              caller&rsquo;s extra controls (the ingredient list&rsquo;s &ldquo;for Everyone&rdquo; select) ride in <code>trailing</code>, before Cancel.
            </p>
          </div>

          {/* Menu Monster ingredient list — the scout workspace's one list component (read and menu-edit
              modes live; author is reserved for Phase 4). Rows are plain data, so the specimens need no catalog. */}
          <div className={sg.specimenBlock}>
            <IngredientList
              mode="read"
              ariaLabel="Pancakes ingredients (specimen)"
              rows={[
                { key: 'a', name: 'Pancake mix', amount: '3½ cups', note: 'everyone else' },
                { key: 'b', name: 'Almond flour', amount: '1 cup', note: 'gluten-free only' },
                { key: 'c', name: 'Eggs', amount: '2', note: null }
              ]}
            />
            <p className={sg.specimenInlineNote}>
              <code>IngredientList</code> from <code>library/menu-monster/_components/ingredient-list</code> &mdash; name, a quiet diet note,
              the amount for the view (total for the meal, or per person) in a fixed right column. Built from the engine by{' '}
              <code>lib/menu-monster/ingredient-rows</code>; <code>mode</code> reserves <code>author</code> (Phase 4).
            </p>
          </div>

          {/* Same component, menu-edit mode: a menu's own version of a recipe. */}
          <div className={sg.specimenBlock}>
            <PublicMenuEditListSpecimen />
            <p className={sg.specimenInlineNote}>
              <code>IngredientList mode=&quot;menu-edit&quot;</code> &mdash; a ⋯ per row (Change amount, Swap for…, Leave out; Put back,
              Back to the troop amount, Remove where they apply), the troop&rsquo;s old value struck (changed amount, swapped item), a quiet
              &ldquo;Added&rdquo; tag, left-out rows dimmed with &ldquo;Left out&rdquo;, and a dashed &ldquo;Add an ingredient&rdquo;
              search. Rows from <code>menuEditRows</code>; the page turns each <code>RowAction</code> into ops.
            </p>
          </div>

          {/* Diet rows + the "Add for" choice (menu-edit; the read list shows the same markers). */}
          <div className={sg.specimenBlock}>
            <PublicDietRowsSpecimen />
            <div className={sg.specimenGap} />
            <IngredientList
              mode="read"
              ariaLabel="Pancakes ingredients, diet rows, read-only (specimen)"
              rows={[
                { key: 'a', name: 'Pancake mix', amount: '3½ cups', note: null, scope: { mode: 'except', restrictions: ['gf'], idle: false } },
                { key: 'b', name: 'Almond flour', amount: '1 cup', note: null, scope: { mode: 'only', restrictions: ['gf'], idle: true } }
              ]}
            />
            <p className={sg.specimenInlineNote}>
              <strong>Diet rows</strong> &mdash; a line for one diet&rsquo;s scouts: a quiet tag from <code>scopeLabel</code> (&ldquo;Gluten-free
              scouts only&rdquo;, &ldquo;except gluten-free&rdquo;); with nobody on the meal in that diet the row dims and <code>idleLabel</code> says
              why. Never colour alone. <strong>Add for</strong> &mdash; the select beside the add search (Everyone, or a diet on the meal); a
              brand-new food lands for those scouts too. Shown only when the meal has a diet. Both modes of <code>IngredientList</code>.
            </p>
          </div>

          {/* StepStrip, a leader's five steps (Review joins as a fifth step). */}
          <div className={sg.specimenBlock}>
            <StepStrip
              config={{ people: '#', plan: '#', gear: '#', shopping: '#', review: '#', share: { label: 'Share', href: '#' } }}
              done={{ eating: true, meals: true, gear: true, shopping: false }}
              current="review"
            />
            <p className={sg.specimenInlineNote}>
              <code>StepStrip</code> with <code>config.review</code> &mdash; a leader&rsquo;s fifth step, Review, after Shopping; ticks on the four
              planning steps, none on Review. Absent for everyone else.
            </p>
          </div>

          {/* Blocked save (D-331) */}
          <div className={sg.specimenBlock}>
            <PublicBlockedSaveSpecimen />
            <p className={sg.specimenInlineNote}>
              <code>Field problem</code> + <code>SaveProblem</code> from <code>_components/form</code> &mdash; Add/Save/Share stays enabled on an
              incomplete form; pressed, it outlines each bad field (<code>aria-invalid</code>), says why in a sentence under it, focuses the first,
              and prints &ldquo;Can&rsquo;t add yet: &hellip; (+N more)&rdquo; beside the button until the form is whole.
            </p>
          </div>

          {/* Amount scale */}
          <div className={sg.specimenBlock}>
            <PublicAmountScaleSpecimen />
            <p className={sg.specimenInlineNote}>
              <code>AmountEditor</code> with <code>canScale</code> from <code>menu-monster/_components/ingredient-list-edit</code> &mdash; a recipe
              line is per person unless it is marked &ldquo;whole meal&rdquo; (4 cups of oil however many are eating): two radios beside the box,
              committed with it. A menu&rsquo;s own edit keeps the troop line&rsquo;s scale and only says it.
            </p>
          </div>

          {/* Shopping finishing line */}
          <div className={sg.specimenBlock}>
            <PublicFinishLineSpecimen />
            <p className={sg.specimenInlineNote}>
              <code>FinishLine</code> from <code>menu-monster/menus/_components/finish-line</code> &mdash; the Shopping step&rsquo;s done-state under
              the totals, derived from planProgress and never stored. Nothing to fix reads &ldquo;Ready to shop&rdquo; with Print and (owner of a
              saved menu only) Share; otherwise &ldquo;N to fix before shopping&rdquo; is a link to the first fix.
            </p>
          </div>

          {/* GearPicker + GearChips */}
          <div className={sg.specimenBlock}>
            <PublicGearSpecimen />
            <p className={sg.specimenInlineNote}>
              <code>GearPicker</code> + <code>GearChips</code> from <code>library/menu-monster/_components/gear-picker</code> &mdash; gear is picked
              from the troop&rsquo;s list, never typed (no match says so, and never offers to create it). Chips A to Z, each with a &minus; n +
              count (&ldquo;Skillet &times; 2&rdquo;) and a remove. The recipe editor and a meal use both; the menu&rsquo;s Gear tab the picker alone.
            </p>
          </div>

          {/* Library MB requirement row — icon-only actions with tooltip
              bubbles (mb-tracker.module.css .act/.tip; Plans/Library-MB-
              Consolidation.md Phase 2, 2026-09-07). Hover or Tab to an icon
              for its bubble; the accessible name carries the code. Rendered
              from the live client component, so it cannot drift. */}
          <div className={sg.specimenBlock}>
            <MbRequirementRows
              anchorId="specimen-requirements"
              intro={<MbLegend showClaim />}
              rows={[
                {
                  key: 'specimen-4a',
                  code: '4a',
                  label: 'Compare at least two waterproofing methods for a tent vs. boots',
                  top: false,
                  pill: { state: 'done', text: 'Done · Apr 19', title: 'Specimen — done Apr 19' },
                  what: '4a',
                  count: 1,
                  detail: (
                    <span className={sg.specimenInlineNote}>
                      (resource lines render here — see any badge page)
                    </span>
                  ),
                  more: null,
                  moreCount: 0,
                  proofHref: null,
                  suggestHref: '#specimen',
                  children: []
                },
                {
                  key: 'specimen-4b',
                  code: '4b',
                  label: 'Describe the four classes of fires and extinguishers',
                  top: false,
                  pill: null,
                  what: '4b',
                  count: 0,
                  detail: null,
                  more: null,
                  moreCount: 0,
                  proofHref: '#specimen',
                  suggestHref: '#specimen',
                  children: []
                }
              ]}
            />
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

          {/* Verified Signup (2026-08-26): the one status bar both signup forms
              render, and the "Sign in to sign up" panel a troop-password-only
              visitor sees. Trouble line: no number, no title — by decision. */}
          <div className={sg.specimenBlock}>
            <SignupStatusBar
              signedInAs="Dana Bieser"
              household={{ label: 'Bieser', standaloneAdult: false }}
              changeHref="#specimen"
              signOut={null}
            />
            <SignInToSignUpPanel next="/events/1/signup" />
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
          celebration-gold award pair (mint <code>--award-gold</code> on a 3rd use); 16
          dynamic inline sites (the photo library&rsquo;s four views added 5 on
          2026-08-22 &mdash; each paints a category colour that lives in{' '}
          <code>calendar_categories</code> and is editable in Lookups, which no class
          can express; the MB tree&rsquo;s two depth indents left on 2026-09-07); the
          Library MB page&rsquo;s icon-only row action with tooltip bubble
          (<code>mb-tracker.module.css .act/.tip</code>, specimen above) &mdash; one
          consumer so far; promote to <code>_components/</code> on a second.
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
