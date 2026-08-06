'use client';

import { useMemo, useState } from 'react';
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
  const [topCode, setTopCode] = useState('');
  const [leafCode, setLeafCode] = useState('');

  const selectedGroup = useMemo(() => groups.find((g) => g.code === topCode) ?? null, [groups, topCode]);

  function onTopChange(code: string) {
    setTopCode(code);
    const group = groups.find((g) => g.code === code);
    // A group with exactly one leaf (the top-level code itself has no
    // children) needs no second pick.
    setLeafCode(group && group.leaves.length === 1 ? group.leaves[0].code : '');
  }

  const proofHref =
    leafCode && `/library/submit-proof?target=${encodeURIComponent(`mb_req:${mbId}-${leafCode}`)}`;

  if (scoutBlocked) {
    return (
      <div className={styles.formCard} style={{ marginTop: 16 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: 4 }}>
          I did this
        </h2>
        <p className={styles.fieldHint}>
          Scouts: proof can&rsquo;t be submitted from this login yet — ask a parent to send it
          in, or show a leader in person.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.formCard} style={{ marginTop: 16 }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: 4 }}>
        I did this
      </h2>
      <p className={styles.fieldHint} style={{ marginBottom: 14 }}>
        Pick the requirement you completed. A leader reviews your submission before it
        counts.
      </p>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="mb-proof-top">
          Requirement
        </label>
        <select
          id="mb-proof-top"
          className={styles.selectInput}
          value={topCode}
          onChange={(e) => onTopChange(e.target.value)}
        >
          <option value="">— pick a requirement —</option>
          {groups.map((g) => (
            <option key={g.code} value={g.code}>
              {g.code} — {g.label.slice(0, 70)}
              {g.label.length > 70 ? '…' : ''}
            </option>
          ))}
        </select>
      </div>

      {selectedGroup && selectedGroup.leaves.length > 1 && (
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="mb-proof-leaf">
            Which part?
          </label>
          <select
            id="mb-proof-leaf"
            className={styles.selectInput}
            value={leafCode}
            onChange={(e) => setLeafCode(e.target.value)}
          >
            <option value="">— pick one —</option>
            {selectedGroup.leaves.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code} — {l.label.slice(0, 70)}
                {l.label.length > 70 ? '…' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {proofHref ? (
        <a className={styles.btnPrimary} href={proofHref}>
          Continue →
        </a>
      ) : (
        <button className={styles.btnSecondary} type="button" disabled>
          Continue →
        </button>
      )}
    </div>
  );
}
