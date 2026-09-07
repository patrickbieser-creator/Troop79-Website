'use client';

/**
 * The interactive half of the consolidated Requirements list
 * (Plans/Library-MB-Consolidation.md Phase 2; spec = prototypes/library-mb,
 * rev 4, Patrick-approved 2026-09-07). MbRequirementsTree (server) shapes
 * every row — labels, pills, hrefs, and the already-rendered resource lines —
 * and this component only owns what needs a click: which rows are open,
 * which groups are folded, which rows show their "+N more", and the
 * Expand all / Collapse all pair on the divider.
 *
 * ACCORDION = button + `hidden` + aria-expanded/aria-controls, deliberately
 * NOT <details>: D-070 (2026-07-25) found a closed native <details> can't be
 * reliably forced open on this browser stack and it shipped blank content in
 * production twice. Everything hidden here is hidden by an attribute React
 * owns, so "Expand all" is a state change, not a CSS override.
 *
 * ICON RULES (Patrick, 2026-09-07, final — see the legend):
 *   1. View resources (count) — only when the row has any; it and the
 *      requirement text open the row.
 *   2. I did this — only while the selected scout still needs it; hidden
 *      (not greyed) once done or pending; never for a visitor. Links to the
 *      real /library/submit-proof page (the prototype's in-page dialog maps
 *      to that route).
 *   3. Suggest a resource — always, every viewer. Links to /library/submit
 *      pre-targeted at this exact requirement.
 * Each is icon-only with a tooltip bubble on hover/focus-visible and an
 * accessible name that includes the code, so a screen reader hears
 * "Suggest a resource — 4a", never twelve identical "Suggest" buttons.
 */
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { SectionDivider } from '@/app/_components/section-divider';
import { IconResources, IconClaim, IconSuggest } from './mb-icons';
import s from './mb-tracker.module.css';

export interface MbRowPill {
  state: 'done' | 'pending';
  text: string;
  title: string;
}

export interface MbRow {
  /** Stable id for aria-controls — the requirement's row id, or 'mb'. */
  key: string;
  /** The tag text — a requirement code, or 'MB' for the whole-badge row. */
  code: string;
  /** Ghost tag (outlined, not filled) — the whole-badge row only. */
  ghost?: boolean;
  label: string;
  /** Top-level rows get the larger tag and the display face. */
  top: boolean;
  /** Muted optionality suffix on a parent row ("do any one of the following"). */
  note?: string;
  /** Muted "3/4" on a parent row — how many parts the selected scout has done. */
  frac?: string;
  pill: MbRowPill | null;
  /** The noun in accessible names: the code, or 'whole badge'. */
  what: string;
  /** Resources + counselor note behind the View-resources icon (0 = no icon). */
  count: number;
  /** Server-rendered: the first three resources and the counselor note. */
  detail: ReactNode;
  /** Server-rendered: everything past the first three (null when none). */
  more: ReactNode;
  moreCount: number;
  /** null = no "I did this" on this row. */
  proofHref: string | null;
  suggestHref: string;
  children: MbRow[];
}

export function MbRequirementRows({
  rows,
  anchorId,
  intro
}: {
  rows: MbRow[];
  /** The header's "I did this ↓" jump target — lands on the divider. */
  anchorId: string;
  /** Rendered by the server above the rows: disclaimer, legend, any notes. */
  intro: ReactNode;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [shownMore, setShownMore] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const expandAll = () => {
    setCollapsed(new Set());
    setOpen(new Set(walk(rows).filter((r) => r.count > 0).map((r) => r.key)));
  };
  const collapseAll = () => {
    setCollapsed(new Set(walk(rows).filter((r) => r.children.length > 0).map((r) => r.key)));
    setOpen(new Set());
  };

  const renderRow = (row: MbRow): ReactNode => {
    const hasKids = row.children.length > 0;
    const hasDetail = row.count > 0;
    const subId = `mb-req-sub-${row.key}`;
    const kidsId = `mb-req-kids-${row.key}`;
    const isOpen = open.has(row.key);
    const kidsOpen = !collapsed.has(row.key);

    // The label: a toggle for the group's children when it has any, a toggle
    // for its own resources when it has those, plain text otherwise.
    let label: ReactNode;
    if (hasKids) {
      label = (
        <button
          type="button"
          className={s.rqToggle}
          aria-expanded={kidsOpen}
          aria-controls={kidsId}
          onClick={() => setCollapsed((c) => toggle(c, row.key))}
        >
          <span className={s.chev} aria-hidden="true">
            ▾
          </span>
          {row.label}
        </button>
      );
    } else if (hasDetail) {
      label = (
        <button
          type="button"
          className={s.rqOpen}
          aria-expanded={isOpen}
          aria-controls={subId}
          onClick={() => setOpen((o) => toggle(o, row.key))}
        >
          {row.label}
        </button>
      );
    } else {
      label = <span>{row.label}</span>;
    }

    return (
      <div key={row.key}>
        <div
          className={[s.rq, row.top ? s.rqTop : null, hasKids ? s.rqGroup : null]
            .filter(Boolean)
            .join(' ')}
          data-req={row.key}
        >
          <span
            className={[s.rqTag, row.top ? s.rqTagLarge : null, row.ghost ? s.rqTagGhost : null]
              .filter(Boolean)
              .join(' ')}
          >
            {row.code}
          </span>
          <div className={s.rqText}>
            {label}
            {row.note && <span className={s.rqRule}>({row.note})</span>}
            {row.frac && <span className={s.frac}>{row.frac}</span>}
            {row.pill && (
              <span
                className={row.pill.state === 'pending' ? `${s.pill} ${s.pillPending}` : s.pill}
                title={row.pill.title}
              >
                {row.pill.text}
              </span>
            )}
          </div>
          <span className={s.rqActs}>
            {hasDetail && (
              <Act
                name={`View resources — ${row.what} (${row.count})`}
                expanded={isOpen}
                controls={subId}
                onClick={() => setOpen((o) => toggle(o, row.key))}
              >
                <IconResources />
                <span className={s.actCount}>{row.count}</span>
              </Act>
            )}
            {row.proofHref && (
              <Act name={`I did this — ${row.what}`} href={row.proofHref} tone="proof">
                <IconClaim />
              </Act>
            )}
            <Act name={`Suggest a resource — ${row.what}`} href={row.suggestHref}>
              <IconSuggest />
            </Act>
          </span>
          {hasDetail && (
            <div className={s.rqSub} id={subId} hidden={!isOpen}>
              {row.detail}
              {row.moreCount > 0 &&
                (shownMore.has(row.key) ? (
                  row.more
                ) : (
                  <button
                    type="button"
                    className={s.moreBtn}
                    onClick={() => setShownMore((m) => toggle(m, row.key))}
                  >
                    +{row.moreCount} more
                  </button>
                ))}
            </div>
          )}
        </div>
        {hasKids && (
          <div className={s.rqKids} id={kidsId} hidden={!kidsOpen}>
            {row.children.map(renderRow)}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div id={anchorId}>
        <SectionDivider
          label="Requirements"
          link={
            <span className={s.divActions}>
              <button type="button" className={s.divBtn} onClick={expandAll}>
                Expand all
              </button>
              <span className={s.divSep} aria-hidden="true">
                ·
              </span>
              <button type="button" className={s.divBtn} onClick={collapseAll}>
                Collapse all
              </button>
            </span>
          }
        />
      </div>
      <div className={s.reqCard}>
        {intro}
        <div>{rows.map(renderRow)}</div>
      </div>
    </>
  );
}

/** Every row, depth-first. */
function walk(rows: MbRow[]): MbRow[] {
  return rows.flatMap((r) => [r, ...walk(r.children)]);
}

/**
 * One icon-only action: a <button> when it toggles, a <Link> when it
 * navigates. `name` is BOTH the accessible name (aria-label) and the
 * tooltip bubble — one string, so they can never disagree. The bubble is
 * visually hidden until hover/focus-visible and absolutely positioned, so
 * showing it never reflows the row (verified at 375 px in the prototype).
 */
function Act({
  name,
  href,
  onClick,
  expanded,
  controls,
  tone,
  children
}: {
  name: string;
  href?: string;
  onClick?: () => void;
  expanded?: boolean;
  controls?: string;
  tone?: 'proof';
  children: ReactNode;
}) {
  const cls = tone === 'proof' ? `${s.act} ${s.actProof}` : s.act;
  const tip = (
    <span className={s.tip} aria-hidden="true">
      {name}
    </span>
  );
  if (href) {
    return (
      <Link href={href} className={cls} aria-label={name}>
        {children}
        {tip}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      aria-label={name}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
    >
      {children}
      {tip}
    </button>
  );
}
