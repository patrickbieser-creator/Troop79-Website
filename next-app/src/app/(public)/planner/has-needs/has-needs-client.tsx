'use client';

/**
 * The Has/Needs tab's client side (Plans/Build-A-Plan.md, B7), ported from Admin's has-needs tool onto the public
 * tokens and components. "Who is where on this?": you pick the requirements, the page splits the active scouts. No
 * ranking, teacher or invite logic (that is Suggestions and Invite).
 *
 * Desktop, three zones: the picker (320px; the four lower ranks' trees with leaf checkboxes, a group shown with its
 * rule but never ticked; merit badges as a searchable chip grid that drills into one badge), the results (Has · Needs ·
 * Partial, Partial naming what's missing, plain count headings with one aria-live summary line, a rank filter), and a sticky "Checked (n)" tray
 * of removable chips with Clear. Phone: a Requirements | Results switch, a sticky "N checked · N have · N need · See
 * who" bar, a two-column badge grid, stacked lists, 44px targets.
 *
 * The selection lives in the URL (`?pick=<key>,<key>`, replaceState), so a view can be shared and comes back on load
 * and on back/forward. Everything is computed here from the page's one load (lib/has-needs splitScouts).
 *
 * The add hook (Patrick: yes): when exactly one requirement is the whole selection, a seed holder can add its
 * top-level requirement to one of the next meetings' plans through Build a Plan's own plannerAddOfferingAction (which
 * checks the seed right and the meeting again); "On plan" once it's there.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { EmptyState } from '@/app/_components/empty-state';
import { mbKey, rankKey, splitScouts, type HasNeedsScout } from '@/lib/has-needs';
import { flattenTree, leafLabels, offeringOf, parsePick, pickHref, PICK_CAP_TEXT, togglePick, type PickerBadge, type PickerRank, type PickerRow } from '@/lib/has-needs-picker';
import { plannerAddOfferingAction } from '../build-actions';
import s from './has-needs.module.css';

const ADD_FAILED = 'That didn’t add. Check your connection and try again.';

export function HasNeedsView({
  ranks,
  badges,
  scouts,
  allRanks,
  meetings,
  onPlan,
  canSeed
}: {
  ranks: PickerRank[];
  badges: PickerBadge[];
  scouts: HasNeedsScout[];
  allRanks: { id: string; name: string }[];
  /** The meetings an add can go to, next first ('Oct 25'). Empty without the Seed right. */
  meetings: { entryId: number; label: string }[];
  /** Each of those meetings' plan keys. */
  onPlan: Record<number, string[]>;
  canSeed: boolean;
}) {
  const pathname = usePathname() ?? '/planner/has-needs';
  const params = useSearchParams();
  const labels = useMemo(() => leafLabels(ranks, badges), [ranks, badges]);
  const known = useMemo(() => new Set(labels.keys()), [labels]);

  // The URL is the selection: read on load and on back/forward, written on every change.
  const urlPick = params?.get('pick') ?? '';
  const [seen, setSeen] = useState(urlPick);
  const [checked, setChecked] = useState<string[]>(() => parsePick(urlPick, known));
  if (urlPick !== seen) {
    setSeen(urlPick);
    setChecked(parsePick(urlPick, known));
  }
  const commit = (next: string[]) => {
    setChecked(next);
    setSeen(next.join(','));
    window.history.replaceState(null, '', pickHref(pathname, next));
  };
  const [capped, setCapped] = useState(false);
  const toggle = (key: string) => {
    const t = togglePick(checked, key);
    setCapped(t.capped);
    if (!t.capped) commit(t.next);
  };

  const [pane, setPane] = useState<'requirements' | 'results'>(checked.length ? 'results' : 'requirements');
  const [rankFilter, setRankFilter] = useState('');
  const rankName = useMemo(() => new Map(allRanks.map((r) => [r.id, r.name])), [allRanks]);
  const rankChoices = allRanks.filter((r) => scouts.some((x) => x.currentRank === r.id));
  const shown = rankFilter ? scouts.filter((x) => x.currentRank === rankFilter) : scouts;
  const { has, needs, partial } = useMemo(() => splitScouts(checked, shown), [checked, shown]);

  // ── the add hook ──
  const single = canSeed && checked.length === 1 && meetings.length ? offeringOf(checked[0], ranks, badges) : null;
  const [meetingId, setMeetingId] = useState(meetings[0]?.entryId ?? 0);
  const [plans, setPlans] = useState(onPlan);
  const [adding, setAdding] = useState(false);
  const [addProblem, setAddProblem] = useState<string | null>(null);
  const meetingLabel = meetings.find((m) => m.entryId === meetingId)?.label ?? '';
  const add = async () => {
    if (!single || adding) return;
    setAdding(true);
    setAddProblem(null);
    const res = await plannerAddOfferingAction({ entryId: meetingId, keys: [single.key] }).catch(() => ({ ok: false as const, error: ADD_FAILED }));
    setAdding(false);
    if (!res.ok) {
      setAddProblem(res.error);
      return;
    }
    setPlans((p) => ({ ...p, [meetingId]: [...(p[meetingId] ?? []), single.key] }));
  };

  const scoutRow = (x: HasNeedsScout, missing?: string[]) => (
    <li key={x.id} className={s.scout}>
      <span className={s.scoutName}>{x.displayName}</span>
      {x.currentRank ? <span className={s.scoutRank}>{rankName.get(x.currentRank) ?? x.currentRank}</span> : null}
      {missing ? <span className={s.missing}>needs {missing.map((k) => labels.get(k) ?? k).join(', ')}</span> : null}
    </li>
  );
  const column = (name: string, n: number, list: ReactNode[]) => (
    <section className={s.col} aria-label={name}>
      <h2 className={s.colHead}>
        {name} ({n})
      </h2>
      {list.length ? <ul className={s.list}>{list}</ul> : <p className={s.none}>None.</p>}
    </section>
  );

  return (
    <>
      <div className={s.switch}>
        <span className={s.seg} role="radiogroup" aria-label="Show">
          {(
            [
              ['requirements', 'Requirements'],
              ['results', 'Results']
            ] as const
          ).map(([v, label]) => (
            <label key={v} className={v === pane ? s.segOn : s.segOption}>
              <input type="radio" className={s.segInput} name="has-needs-pane" value={v} checked={v === pane} onChange={() => setPane(v)} />
              {label}
            </label>
          ))}
        </span>
      </div>
      <div className={s.layout} data-pane={pane}>
        <Picker ranks={ranks} badges={badges} checked={checked} onToggle={toggle} />

        <section className={s.results} aria-label="Results">
          <div className={s.resultsBar}>
            <p className={s.note}>Showing active scouts, {shown.length}</p>
            <label className={s.filter}>
              <span className={s.srOnly}>Rank</span>
              <select className={s.select} value={rankFilter} onChange={(e) => setRankFilter(e.target.value)}>
                <option value="">All ranks</option>
                {rankChoices.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className={s.srOnly} aria-live="polite">
            {checked.length ? `${has.length} have · ${needs.length} need · ${partial.length} partial` : ''}
          </p>
          {checked.length === 0 ? (
            <EmptyState>Tick a requirement to see who has it and who needs it.</EmptyState>
          ) : (
            <div className={s.cols}>
              {column(
                'Has',
                has.length,
                has.map((x) => scoutRow(x))
              )}
              {column(
                'Needs',
                needs.length,
                needs.map((x) => scoutRow(x))
              )}
              {column(
                'Partial',
                partial.length,
                partial.map((p) => scoutRow(p.scout, p.missingKeys))
              )}
            </div>
          )}
        </section>

        <aside className={s.tray} aria-labelledby="has-needs-checked">
          <h2 id="has-needs-checked" className={s.trayHead}>
            Checked ({checked.length})
          </h2>
          {checked.length ? (
            <>
              <ul className={s.chips}>
                {checked.map((k) => (
                  <li key={k}>
                    <button type="button" className={s.chip} onClick={() => toggle(k)} aria-label={`Remove ${labels.get(k) ?? k}`}>
                      {labels.get(k) ?? k} <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={s.quiet}
                onClick={() => {
                  setCapped(false);
                  commit([]);
                }}
              >
                Clear
              </button>
            </>
          ) : (
            <p className={s.none}>Nothing ticked.</p>
          )}
          {capped ? (
            <p className={s.problem} role="status">
              {PICK_CAP_TEXT}
            </p>
          ) : null}
          {single ? (
            <div className={s.add}>
              {meetings.length > 1 ? (
                <label className={s.filter}>
                  <span className={s.srOnly}>Meeting</span>
                  <select className={s.select} value={meetingId} onChange={(e) => setMeetingId(Number(e.target.value))}>
                    {meetings.map((m) => (
                      <option key={m.entryId} value={m.entryId}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {(plans[meetingId] ?? []).includes(single.key) ? (
                <p className={s.onPlan} role="status">
                  On plan
                </p>
              ) : (
                <Button variant="secondary" onClick={add} aria-disabled={adding || undefined}>
                  {adding ? 'Adding…' : `Add ${single.label} to ${meetingLabel} plan`}
                </Button>
              )}
              {addProblem ? (
                <p className={s.problem} role="alert">
                  {addProblem}
                </p>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
      {pane === 'requirements' ? (
        <div className={s.phoneBar}>
          <span className={s.phoneCounts}>
            {checked.length} checked · {has.length} have · {needs.length} need
          </span>
          <Button variant="primary" onClick={() => setPane('results')}>
            See who
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** The picker: the four lower ranks, then the merit badges (a chip grid that drills into one badge's tree). */
function Picker({ ranks, badges, checked, onToggle }: { ranks: PickerRank[]; badges: PickerBadge[]; checked: string[]; onToggle: (key: string) => void }) {
  const [activeMb, setActiveMb] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const on = new Set(checked);
  const term = q.trim().toLowerCase();
  const visible = term ? badges.filter((b) => b.name.toLowerCase().includes(term)) : badges;
  const countByMb = new Map<string, number>();
  for (const k of checked) {
    if (!k.startsWith('mb:')) continue;
    const b = badges.filter((x) => k.startsWith(`mb:${x.id}-`)).sort((a, c) => c.id.length - a.id.length)[0];
    if (b) countByMb.set(b.id, (countByMb.get(b.id) ?? 0) + 1);
  }
  const badge = activeMb ? (badges.find((b) => b.id === activeMb) ?? null) : null;

  return (
    <nav className={s.picker} aria-label="Requirements">
      {ranks.map((r) => (
        <details key={r.id} className={s.rank}>
          <summary className={s.rankSummary}>{r.name}</summary>
          <Rows rows={flattenTree(r.tree, (c) => rankKey(r.id, c))} on={on} onToggle={onToggle} />
        </details>
      ))}
      <div className={s.badges}>
        {badge ? (
          <>
            <button type="button" className={s.quiet} onClick={() => setActiveMb(null)}>
              ← All merit badges
            </button>
            <p className={s.badgeName}>
              {badge.name}
              {badge.eagle ? <span className={s.optionality}>Eagle-required</span> : null}
            </p>
            <Rows rows={flattenTree(badge.tree, (c) => mbKey(badge.id, c))} on={on} onToggle={onToggle} />
          </>
        ) : (
          <>
            <p className={s.badgesHead}>Merit badges</p>
            <input
              type="search"
              className={s.search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQ('');
              }}
              placeholder="Find a badge"
              aria-label="Find a merit badge"
            />
            {visible.length ? (
              <ul className={s.badgeGrid}>
                {visible.map((b) => (
                  <li key={b.id}>
                    <button type="button" className={s.badgeChip} onClick={() => setActiveMb(b.id)}>
                      <span>{b.name}</span>
                      {countByMb.get(b.id) ? <span className={s.badgeCount}>{countByMb.get(b.id)}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.none}>No badge matches “{q.trim()}”.</p>
            )}
          </>
        )}
      </div>
    </nav>
  );
}

/** One tree's rows: a leaf is a checkbox; a group shows its rule ("Complete any one") and is never ticked. */
function Rows({ rows, on, onToggle }: { rows: PickerRow[]; on: ReadonlySet<string>; onToggle: (key: string) => void }) {
  return (
    <ul className={s.rows}>
      {rows.map((row) =>
        row.isLeaf ? (
          <li key={row.key} className={s.leaf} data-depth={Math.min(row.depth, 3)}>
            <label className={s.leafLabel}>
              <input type="checkbox" className={s.checkbox} checked={on.has(row.key)} onChange={() => onToggle(row.key)} />
              <span>
                <span className={s.code}>{row.code}</span> {row.label}
              </span>
            </label>
          </li>
        ) : (
          <li key={row.key} className={s.group} data-depth={Math.min(row.depth, 3)}>
            <span className={s.code}>{row.code}</span> {row.label}
            {row.optionality ? <span className={s.optionality}>{row.optionality}</span> : null}
          </li>
        )
      )}
    </ul>
  );
}
