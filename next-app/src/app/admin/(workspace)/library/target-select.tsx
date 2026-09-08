'use client';

/**
 * Target picker shared by the "+ Place" placement form and the narrative
 * editor on /admin/library (Plans/Library-MB-Consolidation.md, Phase 3).
 *
 * One `<select>` of shelves, rank requirements and merit badges — exactly the
 * groups the server builds (targetOptionGroups) — plus, when `includeMbReq`
 * is on and a badge is picked, a second step: "Whole badge" (the `mb:`
 * target, default) or one of THAT badge's requirements, loaded on demand
 * through the server action passed in. The form field is a hidden input
 * carrying the composed value the write paths already accept
 * (`mb_req:{mbId}-{code}`), so neither action changed to gain this.
 *
 * Client island inside plain server-action forms: it owns no submit and no
 * Save state — the "+ Place" form is a one-click action and the narrative
 * picker is a GET; both keep their own controls.
 */

import { useEffect, useState } from 'react';
import type { MbRequirementOption } from '@/lib/library-data';
import type { TargetOptionGroup } from './resource-entry-form';
import styles from './library.module.css';

export type { MbRequirementOption } from '@/lib/library-data';

interface Props {
  groups: TargetOptionGroup[];
  /** The form field name the composed target is submitted under. */
  name: string;
  /** A stored target to reopen — `mb_req:…` lands in both steps. */
  defaultValue?: string;
  includeMbReq: boolean;
  /** Server action (or any loader) returning ONE badge's requirement tree. */
  loadMbRequirementOptions: (mbId: string) => Promise<MbRequirementOption[]>;
}

const MB_PREFIX = 'mb:';
const MB_REQ_PREFIX = 'mb_req:';

/** Sub-requirements sit visibly under their parent; a plain space would be
 *  collapsed inside an <option>, an em space is not. */
const INDENT = ' ';

/** Splits a stored value into the badge step and the requirement step. An
 *  `mb_req:` key is matched against the badge options (longest id wins, so
 *  `first-aid` never claims a `first-aid-x` key). */
function splitDefault(
  value: string,
  groups: TargetOptionGroup[]
): { primary: string; code: string } {
  if (!value.startsWith(MB_REQ_PREFIX)) return { primary: value, code: '' };
  const key = value.slice(MB_REQ_PREFIX.length);
  let best: string | null = null;
  for (const group of groups) {
    for (const option of group.options) {
      if (!option.value.startsWith(MB_PREFIX)) continue;
      const mbId = option.value.slice(MB_PREFIX.length);
      if (key.startsWith(`${mbId}-`) && (!best || mbId.length > best.length)) best = mbId;
    }
  }
  if (!best) return { primary: value, code: '' };
  return { primary: `${MB_PREFIX}${best}`, code: key.slice(best.length + 1) };
}

export function TargetSelect({
  groups,
  name,
  defaultValue = '',
  includeMbReq,
  loadMbRequirementOptions
}: Props) {
  const [initial] = useState(() => splitDefault(defaultValue, groups));
  const [primary, setPrimary] = useState(initial.primary);
  const [code, setCode] = useState(initial.code);
  const [loaded, setLoaded] = useState<{ mbId: string; options: MbRequirementOption[] } | null>(null);

  const mbId = includeMbReq && primary.startsWith(MB_PREFIX) ? primary.slice(MB_PREFIX.length) : null;

  useEffect(() => {
    if (!mbId) return;
    let alive = true;
    loadMbRequirementOptions(mbId).then((options) => {
      if (alive) setLoaded({ mbId, options });
    });
    return () => {
      alive = false;
    };
  }, [mbId, loadMbRequirementOptions]);

  // Options belong to the badge currently picked, or they are stale.
  const options = loaded && loaded.mbId === mbId ? loaded.options : null;
  const value = mbId && code ? `${MB_REQ_PREFIX}${mbId}-${code}` : primary;

  return (
    <>
      <select
        className={styles.selectInput}
        aria-label="Target page"
        value={primary}
        onChange={(e) => {
          setPrimary(e.target.value);
          setCode('');
        }}
      >
        <option value="">— pick a shelf or requirement —</option>
        {groups.map((group) => (
          <optgroup key={group.group} label={group.group}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {mbId && (
        <select
          className={styles.selectInput}
          aria-label="Requirement"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        >
          <option value="">Whole badge</option>
          {options === null ? (
            <option value="" disabled>
              Loading requirements…
            </option>
          ) : (
            options.map((option) => (
              <option key={option.code} value={option.code}>
                {INDENT.repeat(option.depth)}
                {option.code} · {option.label}
              </option>
            ))
          )}
        </select>
      )}
      <input type="hidden" name={name} value={value} />
    </>
  );
}
