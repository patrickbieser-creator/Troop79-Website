'use client';

/**
 * Suggestions' lead list (Patrick, 2026-10-29): scouts with only the Scoutmaster conference and/or the board of review
 * left for their next rank, first on the page. Each need shows who sits it, already filled by the rule
 * (lib/planner-reviews: the Scoutmaster; two scouts Second Class or above for a Scout or Tenderfoot board; two First
 * Class or above for Second Class; an adult and a First Class scout for First Class; two adults for Star and Life),
 * each changeable from a list of only the people who fit. "Add to {date}" puts it on that meeting's plan with them
 * (suggestAddReviewAction re-checks all of it). Seed holders get the controls; viewers read the list.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { defaultReviewers, reviewerOptions, reviewRule, type ReviewCandidate, type Reviewer, type ReviewRank } from '@/lib/planner-reviews';
import { suggestAddReviewAction } from './actions';
import s from './suggestions.module.css';

export interface ReviewsMeeting {
  entryId: number;
  label: string;
  onPlan: string[];
}

export function ReviewsPanel({ candidates, pool, ranks, meeting, canSeed }: { candidates: ReviewCandidate[]; pool: Reviewer[]; ranks: ReviewRank[]; meeting: ReviewsMeeting; canSeed: boolean }) {
  if (!candidates.length) return null;
  return (
    <section className={s.reviews} aria-labelledby="sg-reviews">
      <h2 id="sg-reviews" className={s.reviewsHead}>
        Ready for a Scoutmaster conference or board of review
      </h2>
      <p className={s.meta}>Everything else for their next rank is done.</p>
      <ul className={s.reviewList}>
        {candidates.map((c) => (
          <CandidateRow key={c.personId} c={c} pool={pool} ranks={ranks} meeting={meeting} canSeed={canSeed} />
        ))}
      </ul>
    </section>
  );
}

function CandidateRow({ c, pool, ranks, meeting, canSeed }: { c: ReviewCandidate; pool: Reviewer[]; ranks: ReviewRank[]; meeting: ReviewsMeeting; canSeed: boolean }) {
  const router = useRouter();
  const needs = c.needs.map((n) => {
    const rule = reviewRule(n.kind, c.rankId, ranks);
    const opts = rule ? reviewerOptions(rule, pool, c.personId) : { adults: [], scouts: [] };
    return { need: n, rule, opts };
  });
  const [chosen, setChosen] = useState<Record<string, number[]>>(() => Object.fromEntries(needs.map((x) => [x.need.key, x.rule ? defaultReviewers(x.rule, x.opts) : []])));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const open = needs.filter((x) => x.rule && !meeting.onPlan.includes(x.need.key));
  const onPlan = needs.length > 0 && needs.every((x) => meeting.onPlan.includes(x.need.key));

  const add = async () => {
    setBusy(true);
    setProblem(null);
    const res = await suggestAddReviewAction({ entryId: meeting.entryId, personId: c.personId, items: open.map((x) => ({ key: x.need.key, reviewerIds: chosen[x.need.key] ?? [] })) }).catch(() => ({
      ok: false as const,
      error: 'That didn’t add. Check your connection and try again.'
    }));
    setBusy(false);
    if (!res.ok) return setProblem(res.error);
    setAdded(true);
    router.refresh();
  };

  return (
    <li className={s.reviewRow}>
      <div className={s.reviewWho}>
        <span className={s.soloTitle}>{c.name}</span>
        <span className={s.meta}>
          {' '}
          · {c.rankName} · needs {c.needs.map((n) => (n.kind === 'smc' ? 'a Scoutmaster conference' : 'a board of review')).join(' and ')}
        </span>
      </div>
      {needs.map(({ need, rule, opts }) => (
        <div key={need.key} className={s.reviewNeed}>
          <span className={s.reviewLabel}>{need.label}</span>
          {!rule ? (
            <span className={s.meta}>Held by the district, not at a troop meeting.</span>
          ) : meeting.onPlan.includes(need.key) ? (
            <span className={s.meta}>✓ On the {meeting.label} plan</span>
          ) : canSeed ? (
            (chosen[need.key] ?? []).map((id, slot) => {
              const adultSlot = slot < rule.adults;
              const list = adultSlot ? opts.adults : opts.scouts;
              const taken = new Set((chosen[need.key] ?? []).filter((_, i) => i !== slot));
              return (
                <select
                  key={slot}
                  className={s.reviewSelect}
                  aria-label={`${need.label} for ${c.name}: ${adultSlot ? 'adult' : 'scout'} ${slot + 1}`}
                  value={id}
                  onChange={(e) => setChosen((cur) => ({ ...cur, [need.key]: (cur[need.key] ?? []).map((x, i) => (i === slot ? Number(e.target.value) : x)) }))}
                >
                  {list
                    .filter((r) => !taken.has(r.personId))
                    .map((r) => (
                      <option key={r.personId} value={r.personId}>
                        {r.name}
                      </option>
                    ))}
                </select>
              );
            })
          ) : (
            <span className={s.meta}>{pool.filter((r) => (chosen[need.key] ?? []).includes(r.personId)).map((r) => r.name).join(' and ')}</span>
          )}
          {rule && !meeting.onPlan.includes(need.key) && (chosen[need.key] ?? []).length < rule.adults + rule.scouts ? (
            <span className={s.problem}>Not enough people who fit yet.</span>
          ) : null}
        </div>
      ))}
      {canSeed && open.length && !onPlan ? (
        <div className={s.reviewActions}>
          <button type="button" className={s.primary} disabled={busy} onClick={() => void add()}>
            {busy ? 'Adding…' : added ? '✓ Added' : `Add to ${meeting.label}`}
          </button>
          {problem ? (
            <span role="alert" className={s.problem}>
              {problem}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
