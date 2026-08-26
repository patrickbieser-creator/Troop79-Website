'use client';

/**
 * "Find your name" type-ahead (Phase D, reshaped by Patrick 2026-08-16).
 *
 * Nothing is listed until two characters are typed, and the search runs on
 * the SERVER — see lib/signin-roster.ts. This component never holds the
 * roster, so there is no full list to reveal by viewing source, and no
 * surnames in memory: it renders exactly what the server chose to return.
 *
 * The search box is the reason the page works on a phone. The previous cut
 * rendered ~70 rows in one scroll.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import type { SignInCandidate, SignInSearchResult } from '@/lib/signin-roster';
import styles from './signin.module.css';

const MIN_CHARS = 2;
const DEBOUNCE_MS = 200;

export function NameSearch({
  next,
  configured,
  search,
  onPick
}: {
  next?: string;
  configured: boolean;
  search: (query: string) => Promise<SignInSearchResult>;
  onPick: (formData: FormData) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  // Result is tagged with the query it answers. Keeping them together is what
  // lets "searching" and "too short" be DERIVED rather than written from
  // inside the effect — synchronous setState in an effect body triggers
  // cascading renders, which the linter rejects and which would flash the
  // empty state between keystrokes.
  const [answer, setAnswer] = useState<{ query: string; data: SignInSearchResult } | null>(null);
  const [, startTransition] = useTransition();
  // Guards against a slow early request landing after a later, narrower one
  // and repopulating the list with stale matches.
  const seq = useRef(0);

  const trimmed = query.trim();
  const longEnough = trimmed.length >= MIN_CHARS;

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      startTransition(async () => {
        const data = await search(q);
        if (mine === seq.current) setAnswer({ query: q, data });
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, search]);

  const result = answer && answer.query === trimmed ? answer.data : null;
  const searching = longEnough && result === null;

  const tooShort = trimmed.length > 0 && !longEnough;

  return (
    <div>
      <label className={styles.searchField}>
        <span className={styles.searchLabel}>Your name</span>
        <input
          className={styles.searchInput}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Start typing…"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
          aria-describedby="name-search-hint"
        />
        <span className={styles.searchHint} id="name-search-hint">
          Type at least two letters of your first or last name.
        </span>
      </label>

      <div aria-live="polite">
        {tooShort && <p className={styles.searchNote}>Keep typing…</p>}

        {!tooShort && searching && <p className={styles.searchNote}>Searching…</p>}

        {!tooShort && !searching && result && result.candidates.length === 0 && (
          <p className={styles.searchNote}>
            No one by that name. Check the spelling, or ask a leader &mdash; they can sign you in
            another way.
          </p>
        )}

        {!tooShort && !searching && result && result.candidates.length > 0 && (
          <>
            <ul className={styles.pickList}>
              {result.candidates.map((c) => (
                <li key={c.personId}>
                  <Row candidate={c} next={next} configured={configured} onPick={onPick} />
                </li>
              ))}
            </ul>
            {result.truncated && (
              <p className={styles.searchNote}>
                More matches than shown &mdash; keep typing to narrow it down.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  candidate,
  next,
  configured,
  onPick
}: {
  candidate: SignInCandidate;
  next?: string;
  configured: boolean;
  onPick: (formData: FormData) => Promise<void>;
}) {
  if (!candidate.maskedEmail) {
    // Shown, not filtered out. Someone who searches their own name and finds
    // nothing concludes the site is broken; someone who finds themselves and
    // reads "ask a leader" knows what to do next.
    return (
      <div className={styles.pickRowEmpty}>
        <span>
          {candidate.displayName}
          {candidate.isScout && <span className={styles.scoutTag}>scout</span>}
        </span>
        <span className={styles.pickMeta}>no email on file &mdash; ask a leader</span>
      </div>
    );
  }
  return (
    <form action={onPick}>
      {next && <input type="hidden" name="next" value={next} />}
      <input type="hidden" name="personId" value={candidate.personId} />
      <button type="submit" className={styles.pickRow} disabled={!configured}>
        <span className={styles.pickName}>
          {candidate.displayName}
          {candidate.isScout && <span className={styles.scoutTag}>scout</span>}
        </span>
        <span className={styles.pickMeta}>
          {candidate.viaParent ? <>code goes to a parent: {candidate.maskedEmail}</> : candidate.maskedEmail}
        </span>
      </button>
    </form>
  );
}
