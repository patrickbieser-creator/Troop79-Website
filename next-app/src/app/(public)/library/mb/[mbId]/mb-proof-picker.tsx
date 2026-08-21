'use client';

import { useState } from 'react';
import { Button } from '@/app/_components/button';
import { FormCard, FieldHint } from '@/app/_components/form';
import styles from '../../library.module.css';

/**
 * "I did this" for a merit badge page (Plans/Resource-Library.md Phase 2,
 * Patrick 2026-08-06 — in-page sub-code picker, chosen over one CTA per
 * top-level group). Unlike the rank requirement page, an MB page has no
 * per-leaf route — resources are grouped by top-level code on one shared
 * page (mb/[mbId]/page.tsx's own comment: "the badge is the right
 * granularity"). Proof still has to name an exact LEAF code, though — same
 * granularity the ledger and Has/Needs tracking use everywhere else — so
 * this picker asks "which requirement, then which part of it" before
 * linking into /library/submit-proof.
 *
 * Redesigned 2026-08-19 (Patrick + ux-lead): the original shipped as two
 * cascading <select>s — pick a top-level requirement, THEN a second "Which
 * part?" dropdown revealed the sub-requirements. Patrick read that as
 * "sub-requirements aren't shown at all," because the second control simply
 * doesn't exist until you've already picked a group. Replaced with an
 * always-expanded list: one <fieldset>/<legend> per top-level requirement,
 * one radio per leaf, all visible on first paint. Still resolves to exactly
 * one leaf code via native radio-group semantics (one shared `name` across
 * every group). A single-leaf group (no real lettered sub-parts — the leaf
 * IS the top-level requirement) renders as one row, not a heading plus a
 * redundant single radio repeating the same text.
 *
 * Deliberately NOT an accordion/<details> — D-070 (2026-07-25, Scout
 * Clipboard) found a closed native <details>'s content can't be reliably
 * forced open via CSS override on this browser stack; it shipped blank rank
 * blocks in production twice before being reverted. A long tree (First Aid
 * runs ~83 leaves across 15 groups) is contained with a scrolling box
 * instead — scrolling to see more is not the same failure mode as content
 * being hidden until clicked.
 */

interface Leaf {
  code: string;
  label: string;
}

interface TopGroup {
  code: string;
  label: string;
  leaves: Leaf[];
}

export default function MbProofPicker({
  mbId,
  groups,
  scoutBlocked = false
}: {
  mbId: string;
  groups: TopGroup[];
  /** Scout-login sessions can't submit proof at all (Plans/Family-Identity-Auth.md
   *  Phase 0) — skip the picker entirely and explain, rather than letting a
   *  scout pick a requirement only to be refused on submit. */
  scoutBlocked?: boolean;
}) {
  const [leafCode, setLeafCode] = useState('');

  const proofHref =
    leafCode && `/library/submit-proof?target=${encodeURIComponent(`mb_req:${mbId}-${leafCode}`)}`;

  if (scoutBlocked) {
    return (
      <div className={styles.stackGap}>
        <FormCard>
          <h2 className={styles.pickerHeading}>
            I did this
          </h2>
          <FieldHint>
            Scouts: proof can&rsquo;t be submitted from this login yet — ask a parent to send it
            in, or show a leader in person.
          </FieldHint>
        </FormCard>
      </div>
    );
  }

  return (
    <div className={styles.stackGap}>
      <FormCard>
      <h2 className={styles.pickerHeading}>
        I did this
      </h2>
      <FieldHint>
        Pick the requirement you completed. A leader reviews your submission before it
        counts.
      </FieldHint>

      <div className={styles.proofGroupList}>
        {groups.map((g) =>
          g.leaves.length <= 1 ? (
            <label key={g.code} className={styles.proofRadioRow}>
              <input
                type="radio"
                name="leafCode"
                value={g.leaves[0]?.code ?? g.code}
                checked={leafCode === (g.leaves[0]?.code ?? g.code)}
                onChange={() => setLeafCode(g.leaves[0]?.code ?? g.code)}
              />
              <span>
                {g.code} — {g.leaves[0]?.label ?? g.label}
              </span>
            </label>
          ) : (
            <fieldset key={g.code} className={styles.proofGroup}>
              <legend className={styles.proofLegend}>
                {g.code} — {g.label}
              </legend>
              {g.leaves.map((l) => (
                <label key={l.code} className={styles.proofRadioRow}>
                  <input
                    type="radio"
                    name="leafCode"
                    value={l.code}
                    checked={leafCode === l.code}
                    onChange={() => setLeafCode(l.code)}
                  />
                  <span>
                    {l.code} — {l.label}
                  </span>
                </label>
              ))}
            </fieldset>
          )
        )}
      </div>

      {proofHref ? (
        <p className={styles.pickerNote}>
          <Button variant="primary" href={proofHref}>
            Continue →
          </Button>
        </p>
      ) : (
        <p className={styles.pickerNote}>
          <Button variant="secondary" disabled>
            Continue →
          </Button>
        </p>
      )}
      </FormCard>
    </div>
  );
}
