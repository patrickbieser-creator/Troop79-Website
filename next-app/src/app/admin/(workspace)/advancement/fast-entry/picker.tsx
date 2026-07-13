'use client';

import { useMemo, useState, useTransition } from 'react';
import { undoCompletion } from './actions';
import {
  createEvent,
  updateEvent,
  createLeadershipPosition,
  createServiceProject
} from '../lookups/actions';
import {
  itemKey,
  mbAwardItem,
  mbReqItem,
  rankAwardItem,
  rankReqItem,
  type CatalogPayload,
  type Completion,
  type CompletionMap,
  type PickerItem,
  type ReqTreeNode
} from './picker-types';
import styles from './fast-entry.module.css';

type TabId = string;

export interface HistoryRow {
  id: number;
  date: string | null;
  by: string | null;
  code: string;
  label: string | null;
  qty: number;
  unit: string;
  kind?: string;
}

interface Props {
  catalog: CatalogPayload;
  /** Pending selections (clicked but not yet saved). */
  selections: PickerItem[];
  onSelectionsChange: (next: PickerItem[]) => void;
  /** Per-scout completion overlay. When provided, completed items render with
   *  the green check + date badge. */
  completion: CompletionMap;
  /** Notify parent if a completion was undone (so it can refresh its overlay). */
  onCompletionRemoved?: (key: string) => void;
  /** When true, restricts to single selection (used by Requirement-First). */
  multi?: boolean;
  /** Hide Service/Events/Leadership tabs when only catalog reqs make sense. */
  showFreeTabs?: boolean;
  /** When provided, clicking a merit badge in the catalog opens it in a modal
   *  (Scout-First) instead of drilling in inline. */
  onOpenMb?: (mbId: string) => void;
  /** Optional history for the Service/Events/Leadership tabs. Scout-First
   *  card supplies this when a scout is selected. */
  history?: {
    service: HistoryRow[];
    events: HistoryRow[];
    leadership: HistoryRow[];
  };
  /** Called when the user undoes a history row. */
  onHistoryRemoved?: (entryId: number) => void;
  /** Suppress the "N pending" banner normally shown above the tabs. Set by
   *  hosts that render their own pending indicator next to Clear/Save
   *  instead — the banner reflows the tabs down a row on every selection,
   *  which reads as the screen jumping. */
  hidePendingBanner?: boolean;
}

const FREE_TABS: { id: TabId; label: string; kind: string; unitPlaceholder: string }[] = [
  { id: 'service', label: 'Service', kind: 'service_hours', unitPlaceholder: "OLT Cleanup Apr '26" },
  { id: 'events', label: 'Events', kind: 'attendance', unitPlaceholder: 'Spring Campout' },
  { id: 'leadership', label: 'Leadership', kind: 'leadership', unitPlaceholder: 'Patrol Leader' }
];

export function RequirementPicker({
  catalog,
  selections,
  onSelectionsChange,
  completion,
  onCompletionRemoved,
  multi = true,
  showFreeTabs = true,
  onOpenMb,
  history,
  onHistoryRemoved,
  hidePendingBanner = false
}: Props) {
  // Tab order: rank tabs in catalog order (Scout first since ranks come back
  // ordered by sort_order ASC), then MBs, then free-form tabs.
  const tabs: TabId[] = [
    ...catalog.ranks.map((r) => r.id),
    'merit-badges',
    ...(showFreeTabs ? (['service', 'events', 'leadership'] as TabId[]) : [])
  ];
  // Default to the Scout (first) rank tab.
  const [activeTab, setActiveTab] = useState<TabId>(catalog.ranks[0]?.id ?? tabs[0]);
  const [activeMbId, setActiveMbId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [, startTransition] = useTransition();

  const selectionKeys = useMemo(
    () => new Set(selections.map((s) => s.key)),
    [selections]
  );

  function statusFor(item: PickerItem): 'empty' | 'pending' | 'completed' {
    if (completion.has(item.key)) return 'completed';
    if (selectionKeys.has(item.key)) return 'pending';
    return 'empty';
  }

  function handleLeafClick(item: PickerItem) {
    const status = statusFor(item);
    if (status === 'completed') {
      const entry = completion.get(item.key)!;
      promptUndo(item, entry);
      return;
    }
    if (!multi) {
      onSelectionsChange([item]);
      return;
    }
    if (status === 'pending') {
      onSelectionsChange(selections.filter((s) => s.key !== item.key));
    } else {
      onSelectionsChange([...selections, item]);
    }
  }

  function promptUndo(item: PickerItem, entry: Completion) {
    const reason = window.prompt(
      `"${item.label}" was already signed off${
        entry.date ? ' on ' + entry.date : ''
      }${entry.by ? ' by ' + entry.by : ''}.\n\nRemove this completion? Enter a reason (required — duplicate, wrong scout, etc.). The entry will be soft-deleted (recoverable from the Universal Ledger).`,
      ''
    );
    if (reason === null) return;
    const r = reason.trim();
    if (!r) {
      window.alert('Removal cancelled — a reason is required.');
      return;
    }
    const fd = new FormData();
    fd.set('id', String(entry.entryId));
    fd.set('reason', r);
    startTransition(async () => {
      const res = await undoCompletion(fd);
      if (!res.ok) {
        window.alert(`Failed: ${res.error}`);
        return;
      }
      onCompletionRemoved?.(item.key);
    });
  }

  function removePending(item: PickerItem) {
    onSelectionsChange(selections.filter((s) => s.key !== item.key));
  }

  const freeTab = FREE_TABS.find((t) => t.id === activeTab);
  const inMbDetail = activeTab === 'merit-badges' && !!activeMbId;
  const inMbCatalog = activeTab === 'merit-badges' && !activeMbId;
  const activeRank = catalog.ranks.find((r) => r.id === activeTab);

  // Bottom detailed list only keeps items that can't be toggled off from a
  // row in the tree and so need the inline remove (×) — i.e. free-form items
  // (Service / Events / Leadership). Rank requirements/awards always have a
  // checkbox row; MB requirements/awards have one in the inline drill-in flow
  // (Requirement-First), but in the modal flow (Scout-First, onOpenMb set) an
  // MB item can only arrive via URL prefill and the × chip is its sole
  // per-item remove, so it stays. The top "N pending" breadcrumb covers the
  // rest.
  const removablePending = selections.filter((s) => {
    if (s.kind === 'rank_requirement' || s.kind === 'rank_award') return false;
    if (
      !onOpenMb &&
      (s.kind === 'merit_badge_requirement' || s.kind === 'merit_badge_award')
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className={styles.picker}>
      {/* Top pending summary — visible across all tabs */}
      {multi && !hidePendingBanner && selections.length > 0 && (
        <div className={styles.pendingTop}>
          <strong>{selections.length}</strong> pending — click <em>Save</em> when ready
        </div>
      )}

      {/* Tabs */}
      <div className={styles.pickerTabs}>
        {catalog.ranks.map((r) => (
          <TabButton
            key={r.id}
            active={activeTab === r.id}
            onClick={() => {
              setActiveTab(r.id);
              setActiveMbId(null);
              setSearch('');
            }}
            label={r.display_name}
          />
        ))}
        <div className={styles.pickerTabDivider} aria-hidden="true" />
        <TabButton
          active={activeTab === 'merit-badges'}
          onClick={() => {
            setActiveTab('merit-badges');
            setActiveMbId(null);
            setSearch('');
          }}
          label="MBs"
        />
        {showFreeTabs && (
          <>
            <div className={styles.pickerTabDivider} aria-hidden="true" />
            {FREE_TABS.map((t) => (
              <TabButton
                key={t.id}
                active={activeTab === t.id}
                onClick={() => {
                  setActiveTab(t.id);
                  setActiveMbId(null);
                  setSearch('');
                }}
                label={t.label}
              />
            ))}
          </>
        )}
      </div>

      {/* Search row (hidden for free-form tabs) */}
      {!freeTab && (
        <div className={styles.pickerSearch}>
          <input
            type="search"
            placeholder={
              inMbCatalog ? 'Filter badges…' : 'Filter requirements…'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      <div className={styles.pickerBody}>
        {/* Rank tab */}
        {activeRank && (
          <RankPanel
            rank={activeRank}
            search={search}
            completion={completion}
            statusFor={statusFor}
            onLeafClick={handleLeafClick}
          />
        )}

        {/* MB catalog grid */}
        {inMbCatalog && (
          <MbCatalogGrid
            mbs={catalog.mbs}
            search={search}
            completion={completion}
            onPick={(id) => (onOpenMb ? onOpenMb(id) : setActiveMbId(id))}
          />
        )}

        {/* MB drill-in (inline — only when not using the modal flow) */}
        {!onOpenMb && inMbDetail && activeMbId && (
          <MbDetailPanel
            mb={catalog.mbs.find((m) => m.id === activeMbId)!}
            search={search}
            completion={completion}
            statusFor={statusFor}
            onLeafClick={handleLeafClick}
            selections={selections}
            onSelectionsChange={onSelectionsChange}
            onBack={() => setActiveMbId(null)}
          />
        )}

        {/* Free-form */}
        {freeTab?.id === 'events' && (
          <>
            <EventsTab
              events={catalog.events}
              onAdd={(items) => onSelectionsChange([...selections, ...items])}
            />
            <HistoryPanel rows={history?.events ?? []} onUndo={onHistoryRemoved} />
          </>
        )}
        {freeTab?.id === 'service' && (
          <>
            <ServiceTab
              projects={catalog.serviceProjects}
              onAdd={(item) => onSelectionsChange([...selections, item])}
            />
            <HistoryPanel rows={history?.service ?? []} onUndo={onHistoryRemoved} />
          </>
        )}
        {freeTab?.id === 'leadership' && (
          <>
            <LeadershipTab
              positions={catalog.leadershipPositions}
              onAdd={(item) => onSelectionsChange([...selections, item])}
            />
            <HistoryPanel rows={history?.leadership ?? []} onUndo={onHistoryRemoved} />
          </>
        )}
      </div>

      {/* Detailed pending list at bottom — items without a toggleable row
          only (see removablePending above); catalog reqs are excluded to cut
          clutter. */}
      {multi && removablePending.length > 0 && (
        <div className={styles.selectedList}>
          {removablePending.map((s) => (
            <div key={s.key} className={styles.selectedItem}>
              <span>
                <span className={styles.selectedCode}>{s.code}</span> {s.label}
              </span>
              <button
                type="button"
                className={styles.selectedRemove}
                onClick={() => removePending(s)}
                aria-label="Remove"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.pickerTab} ${active ? styles.pickerTabActive : ''}`.trim()}
    >
      {label}
    </button>
  );
}

// ── Optionality helpers ───────────────────────────────────────────────────

function optionalityLabel(node: ReqTreeNode): string | null {
  if (node.complete_rule === 'all') return null;
  if (node.complete_rule === 'any') return 'Complete any of these';
  if (node.complete_rule === 'n-of') {
    return `Complete any ${node.complete_n ?? '?'} of these`;
  }
  return null;
}

/** Recursive satisfaction check. A leaf is satisfied iff its picker key is in
 *  the completion map. A parent is satisfied per its complete_rule. */
function isNodeSatisfied(
  node: ReqTreeNode,
  keyFor: (code: string) => string,
  completion: CompletionMap
): boolean {
  if (node.children.length === 0) {
    return completion.has(keyFor(node.code));
  }
  const satCount = node.children.filter((c) =>
    isNodeSatisfied(c, keyFor, completion)
  ).length;
  switch (node.complete_rule) {
    case 'all':
      return satCount === node.children.length;
    case 'any':
      return satCount >= 1;
    case 'n-of':
      return satCount >= (node.complete_n ?? 0);
    default:
      return satCount === node.children.length;
  }
}

function countDirectSat(
  node: ReqTreeNode,
  keyFor: (code: string) => string,
  completion: CompletionMap
): number {
  return node.children.filter((c) => isNodeSatisfied(c, keyFor, completion))
    .length;
}

function targetN(node: ReqTreeNode): number {
  if (node.children.length === 0) return 0;
  if (node.complete_rule === 'any') return 1;
  if (node.complete_rule === 'n-of') return node.complete_n ?? node.children.length;
  return node.children.length; // all
}

// ── Shared MB selection helpers (used by inline drill-in + focus modal) ─────

/** All collapse keys for a merit badge's parent (group) nodes, keyed the same
 *  way as the tree renderer (itemKey.mbReq(mbId, code)). Used to drive
 *  "Collapse all" / "Expand all". */
export function collectMbGroupKeys(
  mb: CatalogPayload['mbs'][number]
): string[] {
  const out: string[] = [];
  function walk(nodes: ReqTreeNode[]) {
    for (const n of nodes) {
      if (n.children.length > 0) {
        out.push(itemKey.mbReq(mb.id, n.code));
        walk(n.children);
      }
    }
  }
  walk(mb.requirements);
  return out;
}

/** True if any of this MB's requirement leaves are currently pending. */
export function mbHasPending(
  mb: CatalogPayload['mbs'][number],
  selections: PickerItem[]
): boolean {
  return selections.some(
    (s) => s.kind === 'merit_badge_requirement' && s.code.startsWith(`${mb.id}-`)
  );
}

/**
 * "Select all" for a merit badge: walk the tree and top off each parent to its
 * target N (counting completed + already-pending toward the target). Returns a
 * new selections array that includes everything already selected plus the
 * newly-needed leaves. Pure — safe to call from any host.
 */
export function computeMbSmartSelect(
  mb: CatalogPayload['mbs'][number],
  completion: CompletionMap,
  selections: PickerItem[]
): PickerItem[] {
  const keyFor = (code: string) => itemKey.mbReq(mb.id, code);
  const newSelections = [...selections];
  function addItem(node: ReqTreeNode) {
    const key = keyFor(node.code);
    // If completed or already pending, skip.
    if (completion.has(key)) return;
    if (newSelections.some((s) => s.key === key)) return;
    newSelections.push(mbReqItem(mb.id, mb.name, node.code, node.label));
  }
  function walk(node: ReqTreeNode) {
    if (node.children.length === 0) {
      // Bare leaf at this level — automatically required (the parent above
      // already governs how many leaves to take).
      return;
    }
    const target = targetN(node);
    const allLeaves = node.children;
    const sat = allLeaves.filter((c) => isNodeSatisfied(c, keyFor, completion));
    const pendingChildren = allLeaves.filter((c) =>
      c.children.length === 0
        ? newSelections.some((s) => s.key === keyFor(c.code))
        : false
    );
    const have = sat.length + pendingChildren.length;
    let need = Math.max(0, target - have);
    for (const child of allLeaves) {
      if (need <= 0) break;
      if (isNodeSatisfied(child, keyFor, completion)) continue;
      if (child.children.length === 0) {
        // Leaf — add it directly.
        addItem(child);
        need--;
      } else {
        // Sub-parent — recurse so its own rule is satisfied, then count it.
        walk(child);
        need--;
      }
    }
    // If parent itself wraps children that recurse further, recurse on
    // any remaining children (so we don't miss deeper requirements).
    for (const child of allLeaves) {
      if (child.children.length > 0) walk(child);
    }
  }
  // Treat the MB's top-level reqs as an `all` group: every top-level parent
  // must be satisfied. So walk them all.
  for (const top of mb.requirements) {
    if (top.children.length === 0) {
      addItem(top);
    } else {
      walk(top);
    }
  }
  return newSelections;
}

// ── Rank panel ────────────────────────────────────────────────────────────

function RankPanel({
  rank,
  search,
  completion,
  statusFor,
  onLeafClick
}: {
  rank: CatalogPayload['ranks'][number];
  search: string;
  completion: CompletionMap;
  statusFor: (item: PickerItem) => 'empty' | 'pending' | 'completed';
  onLeafClick: (item: PickerItem) => void;
}) {
  const keyFor = (code: string) => itemKey.rankReq(rank.id, code);
  const reqs = rank.requirements;
  const q = search.trim().toLowerCase();
  // Award (BoR) row at the top if rank > Scout (Scout has no BoR catalog row).
  const showAward = rank.id !== 'scout';

  return (
    <>
      {showAward && (
        <ItemRow
          item={rankAwardItem(rank.id, rank.display_name)}
          status={statusFor(rankAwardItem(rank.id, rank.display_name))}
          completion={
            completion.get(
              rankAwardItem(rank.id, rank.display_name).key
            ) ?? null
          }
          codeDisplay="BoR"
          label={`Board of Review — ${rank.display_name}`}
          onClick={() => onLeafClick(rankAwardItem(rank.id, rank.display_name))}
          isAward
        />
      )}
      <ReqTreeRender
        nodes={reqs}
        keyForCode={keyFor}
        depth={0}
        search={q}
        completion={completion}
        statusFor={statusFor}
        onLeafClick={(node) =>
          onLeafClick(rankReqItem(rank.id, rank.display_name, node.code, node.label))
        }
      />
    </>
  );
}

// ── MB drill-in ────────────────────────────────────────────────────────────

function MbCatalogGrid({
  mbs,
  search,
  completion,
  onPick
}: {
  mbs: CatalogPayload['mbs'];
  search: string;
  completion: CompletionMap;
  onPick: (id: string) => void;
}) {
  const q = search.trim().toLowerCase();
  const filtered = q ? mbs.filter((m) => m.name.toLowerCase().includes(q)) : mbs;
  return (
    <div className={styles.mbCatalogGrid}>
      {filtered.map((m) => {
        const earned = completion.has(itemKey.mbAward(m.id));
        return (
          <button
            key={m.id}
            type="button"
            className={`${styles.mbCatalogItem} ${m.eagle ? styles.mbCatalogItemEagle : ''} ${earned ? styles.mbCatalogItemEarned : ''}`.trim()}
            onClick={() => onPick(m.id)}
            title={earned ? 'Already earned' : undefined}
          >
            {m.name}
          </button>
        );
      })}
    </div>
  );
}

function MbDetailPanel({
  mb,
  search,
  completion,
  statusFor,
  onLeafClick,
  selections,
  onSelectionsChange,
  onBack
}: {
  mb: CatalogPayload['mbs'][number];
  search: string;
  completion: CompletionMap;
  statusFor: (item: PickerItem) => 'empty' | 'pending' | 'completed';
  onLeafClick: (item: PickerItem) => void;
  selections: PickerItem[];
  onSelectionsChange: (next: PickerItem[]) => void;
  onBack: () => void;
}) {
  const keyFor = (code: string) => itemKey.mbReq(mb.id, code);
  const q = search.trim().toLowerCase();

  // Determine if any leaf is currently pending for this MB.
  const mbPendingKeys = new Set(
    selections
      .filter((s) => s.kind === 'merit_badge_requirement' && s.code.startsWith(`${mb.id}-`))
      .map((s) => s.key)
  );

  function selectAll() {
    // If anything is pending, "Select All" toggles to "Clear pending".
    if (mbPendingKeys.size > 0) {
      onSelectionsChange(
        selections.filter(
          (s) =>
            !(s.kind === 'merit_badge_requirement' && s.code.startsWith(`${mb.id}-`))
        )
      );
      return;
    }
    onSelectionsChange(computeMbSmartSelect(mb, completion, selections));
  }

  return (
    <>
      <div className={styles.mbDetailHeader}>
        <button type="button" className={styles.mbBackBtn} onClick={onBack}>
          ← All Merit Badges
        </button>
        <span className={styles.mbDetailTitle}>
          {mb.name}
          {mb.eagle && <span className={styles.mbEagleTag}>Eagle</span>}
        </span>
        <button
          type="button"
          className={styles.selectAllBtn}
          onClick={selectAll}
        >
          {mbPendingKeys.size > 0 ? 'Clear pending' : 'Select all'}
        </button>
      </div>

      {/* MB Award at the top */}
      <ItemRow
        item={mbAwardItem(mb.id, mb.name, mb.eagle)}
        status={statusFor(mbAwardItem(mb.id, mb.name, mb.eagle))}
        completion={
          completion.get(mbAwardItem(mb.id, mb.name, mb.eagle).key) ?? null
        }
        codeDisplay="★"
        label={`Full merit badge earned${mb.eagle ? ' (Eagle)' : ''}`}
        onClick={() => onLeafClick(mbAwardItem(mb.id, mb.name, mb.eagle))}
        isAward
      />

      {mb.requirements.length === 0 ? (
        <div className={styles.pickerEmpty}>
          No requirements authored for this merit badge yet. Add them via
          Lookups &amp; Admin → Merit Badge Catalog → Edit.
        </div>
      ) : (
        <ReqTreeRender
          nodes={mb.requirements}
          keyForCode={keyFor}
          depth={0}
          search={q}
          completion={completion}
          statusFor={statusFor}
          onLeafClick={(node) =>
            onLeafClick(mbReqItem(mb.id, mb.name, node.code, node.label))
          }
        />
      )}
    </>
  );
}

// ── Recursive tree renderer (shared by rank panel + MB detail) ─────────────

export function ReqTreeRender({
  nodes,
  keyForCode,
  depth,
  search,
  completion,
  statusFor,
  onLeafClick,
  collapsedKeys,
  onToggleCollapse
}: {
  nodes: ReqTreeNode[];
  keyForCode: (code: string) => string;
  depth: number;
  search: string;
  completion: CompletionMap;
  statusFor: (item: PickerItem) => 'empty' | 'pending' | 'completed';
  onLeafClick: (node: ReqTreeNode) => void;
  /** When provided (modal), parent groups become collapsible. Keyed by the
   *  node's picker key (keyForCode(node.code)). Omitted on inline pickers. */
  collapsedKeys?: Set<string>;
  onToggleCollapse?: (key: string) => void;
}) {
  const filtered = nodes.filter((n) => nodeMatchesSearch(n, search));
  if (filtered.length === 0) {
    return <div className={styles.pickerEmpty}>No requirements match.</div>;
  }
  return (
    <>
      {filtered.map((node) => (
        <NodeRender
          key={node.code}
          node={node}
          keyForCode={keyForCode}
          depth={depth}
          search={search}
          completion={completion}
          statusFor={statusFor}
          onLeafClick={onLeafClick}
          collapsedKeys={collapsedKeys}
          onToggleCollapse={onToggleCollapse}
        />
      ))}
    </>
  );
}

function nodeMatchesSearch(node: ReqTreeNode, q: string): boolean {
  if (!q) return true;
  const hits =
    node.code.toLowerCase().includes(q) ||
    (node.label ?? '').toLowerCase().includes(q);
  if (hits) return true;
  return node.children.some((c) => nodeMatchesSearch(c, q));
}

function NodeRender({
  node,
  keyForCode,
  depth,
  search,
  completion,
  statusFor,
  onLeafClick,
  collapsedKeys,
  onToggleCollapse
}: {
  node: ReqTreeNode;
  keyForCode: (code: string) => string;
  depth: number;
  search: string;
  completion: CompletionMap;
  statusFor: (item: PickerItem) => 'empty' | 'pending' | 'completed';
  onLeafClick: (node: ReqTreeNode) => void;
  collapsedKeys?: Set<string>;
  onToggleCollapse?: (key: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const indent = depth * 18;
  if (hasChildren) {
    const target = targetN(node);
    const satCount = countDirectSat(node, keyForCode, completion);
    const optLabel = optionalityLabel(node);
    const satisfied = satCount >= target;
    const nodeKey = keyForCode(node.code);
    const collapsible = !!onToggleCollapse;
    // A search query forces groups open so matches stay visible.
    const isCollapsed = collapsible && !search && !!collapsedKeys?.has(nodeKey);
    return (
      <>
        <div
          className={`${styles.parentHeader} ${collapsible ? styles.parentHeaderClickable : ''}`.trim()}
          style={{ paddingLeft: 8 + indent }}
          onClick={collapsible ? () => onToggleCollapse!(nodeKey) : undefined}
          role={collapsible ? 'button' : undefined}
          tabIndex={collapsible ? 0 : undefined}
          onKeyDown={
            collapsible
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggleCollapse!(nodeKey);
                  }
                }
              : undefined
          }
        >
          {collapsible && (
            <span className={styles.collapseChevron} aria-hidden="true">
              {isCollapsed ? '▸' : '▾'}
            </span>
          )}
          <span className={styles.parentCode}>{node.code}</span>
          <span className={styles.parentLabel}>{node.label}</span>
          {optLabel && <span className={styles.optPill}>{optLabel}</span>}
          <span
            className={`${styles.satIndicator} ${satisfied ? styles.satIndicatorOk : ''}`}
          >
            {satCount} of {target}
            {satisfied && ' ✓'}
          </span>
        </div>
        {!isCollapsed && (
          <ReqTreeRender
            nodes={node.children}
            keyForCode={keyForCode}
            depth={depth + 1}
            search={search}
            completion={completion}
            statusFor={statusFor}
            onLeafClick={onLeafClick}
            collapsedKeys={collapsedKeys}
            onToggleCollapse={onToggleCollapse}
          />
        )}
      </>
    );
  }
  // Leaf
  // Construct the PickerItem on the fly via statusFor's expected key shape.
  // statusFor lookup uses the item's key built by keyForCode(node.code).
  const tempKey = keyForCode(node.code);
  const status = (function () {
    if (completion.has(tempKey)) return 'completed' as const;
    // Pending check requires inspecting selections — but statusFor takes a
    // PickerItem. We don't have a kind-bound item to compare; rely on
    // statusFor through a minimal stub.
    // The actual handler in onLeafClick will build the real PickerItem.
    const fake: PickerItem = {
      key: tempKey,
      kind: 'merit_badge_requirement', // type doesn't affect status lookup
      code: node.code,
      label: node.label,
      unit: 'complete'
    };
    return statusFor(fake);
  })();
  const c = status === 'completed' ? (completion.get(tempKey) ?? null) : null;
  return (
    <ItemRow
      item={{ key: tempKey, kind: 'merit_badge_requirement', code: node.code, label: node.label, unit: 'complete' }}
      status={status}
      completion={c}
      codeDisplay={node.code}
      label={node.label}
      onClick={() => onLeafClick(node)}
      indentPx={indent}
    />
  );
}

export function ItemRow({
  status,
  completion,
  codeDisplay,
  label,
  onClick,
  indentPx,
  isAward
}: {
  item: PickerItem;
  status: 'empty' | 'pending' | 'completed';
  completion: Completion | null;
  codeDisplay: string;
  label: string;
  onClick: () => void;
  indentPx?: number;
  isAward?: boolean;
}) {
  const checkCls =
    status === 'completed'
      ? styles.pickerCheckCompleted
      : status === 'pending'
        ? styles.pickerCheckPending
        : '';
  const rowCls = status === 'completed' ? styles.pickerRowCompleted : '';
  return (
    <div
      className={`${styles.pickerRow} ${rowCls} ${isAward ? styles.pickerRowAward : ''}`.trim()}
      style={indentPx != null ? { paddingLeft: 8 + indentPx } : undefined}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <span className={`${styles.pickerCheck} ${checkCls}`.trim()}>
        {status === 'completed' ? '✓' : status === 'pending' ? '•' : ''}
      </span>
      <span className={styles.pickerCode}>{codeDisplay}</span>
      <span className={styles.pickerLabel}>{label}</span>
      {completion?.date && (
        <span className={styles.pickerDateBadge}>
          Done {completion.date}
          {completion.by ? ` · ${completion.by}` : ''}
        </span>
      )}
    </div>
  );
}

/**
 * Leadership tab — pick a position from the lookup (or add a new one). Name
 * only; leadership rows carry no quantity (unit 'term', qty defaults to 1).
 */
function LeadershipTab({
  positions,
  onAdd
}: {
  positions: { id: number; name: string }[];
  onAdd: (item: PickerItem) => void;
}) {
  const [selected, setSelected] = useState('');
  const [newName, setNewName] = useState('');
  const [localNames, setLocalNames] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  const names = useMemo(() => {
    const set = new Set<string>();
    for (const p of positions) set.add(p.name);
    for (const n of localNames) set.add(n);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [positions, localNames]);

  const isNew = selected === NEW_EVENT;
  const resolvedName = (isNew ? newName : selected).trim();

  function add() {
    const lbl = resolvedName;
    if (!lbl) return;
    if (isNew && !names.includes(lbl)) {
      setLocalNames((prev) => [...prev, lbl]);
      const fd = new FormData();
      fd.set('name', lbl);
      startTransition(() => {
        createLeadershipPosition(fd);
      });
    }
    const codeBase = autoCode(lbl);
    const code = codeBase.startsWith('LE:') ? codeBase : `LE:${codeBase}`;
    onAdd({
      key: `leadership:${code}`,
      kind: 'leadership',
      code,
      label: lbl,
      unit: 'term'
    });
    setSelected(isNew ? NEW_EVENT : '');
    setNewName('');
  }

  return (
    <div className={styles.freeForm}>
      <p className={styles.freeFormHelp}>
        Pick a leadership position from the list (or add a new one). It appears
        in the pending list and saves when you hit Save.
      </p>
      <label className={styles.field} style={{ marginBottom: 4 }}>
        <span className={styles.fieldLabel}>Position</span>
        <select
          className={styles.select}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">— Select a position —</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={NEW_EVENT}>+ New position…</option>
        </select>
      </label>
      {isNew && (
        <label className={styles.field} style={{ marginBottom: 4 }}>
          <span className={styles.fieldLabel}>New position name</span>
          <input
            type="text"
            className={styles.input}
            placeholder="Patrol Leader"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
        </label>
      )}
      <div>
        <button
          type="button"
          className={styles.btn}
          onClick={add}
          disabled={!resolvedName}
        >
          + Add Leadership
        </button>
      </div>
    </div>
  );
}

/**
 * Events tab — title + optional Nights / Miles / Hours. Each non-zero number
 * creates a separate pending row of the matching kind, so a 2-night campout
 * with a 3-mile hike becomes two rows in the ledger.
 *
 * Every event carries a stored classification (events.default_kind) so a
 * recurring event never needs its Type re-picked. Campout/Hike still need an
 * actual Nights/Miles value to mean anything, so their classification is a
 * hint, not an auto-apply; Day Outing/Fundraiser have no natural quantity, so
 * a classified one applies automatically with no further input. Picking a
 * Type for a brand-new or not-yet-classified event heals it for next time.
 */
const NEW_EVENT = '__new__';

/** Options for the Type selector — offered whenever the event's stored kind
 *  can't be auto-applied (new, unclassified, or a quantity-kind with no
 *  quantity given this time). */
const EVENT_TYPE_OPTIONS: { value: PickerItem['kind']; label: string }[] = [
  { value: 'camping_nights', label: 'Campout' },
  { value: 'hiking_miles', label: 'Hike' },
  { value: 'day_outing', label: 'Day Outing' },
  { value: 'fundraiser', label: 'Fundraiser' }
];
const EVENT_TYPE_LABEL = new Map(EVENT_TYPE_OPTIONS.map((t) => [t.value, t.label]));

function EventsTab({
  events,
  onAdd
}: {
  events: { id: number; name: string; default_kind: PickerItem['kind'] | null }[];
  onAdd: (items: PickerItem[]) => void;
}) {
  const [selected, setSelected] = useState('');
  const [newName, setNewName] = useState('');
  // Events created inline this session (so the dropdown updates before the
  // server catalog reloads on the next refresh).
  const [localEvents, setLocalEvents] = useState<string[]>([]);
  const [nights, setNights] = useState('');
  const [miles, setMiles] = useState('');
  const [hours, setHours] = useState('');
  const [eventKind, setEventKind] = useState('');
  const [, startTransition] = useTransition();

  const names = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) set.add(e.name);
    for (const n of localEvents) set.add(n);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [events, localEvents]);

  const isNew = selected === NEW_EVENT;
  const resolvedName = (isNew ? newName : selected).trim();
  const selectedEvent = !isNew ? events.find((e) => e.name === selected) : undefined;
  const storedKind = selectedEvent?.default_kind ?? null;
  // Only Day Outing/Fundraiser can apply blind — Campout/Hike need an actual
  // Nights/Miles value to mean anything, so they stay a hint, not an auto-fill.
  const autoKind = storedKind === 'day_outing' || storedKind === 'fundraiser' ? storedKind : null;
  const showTypePicker = !autoKind;
  const hasQty = [nights, miles, hours].some((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
  });
  const canSubmit = !!resolvedName && (hasQty || !!autoKind || !!eventKind);

  function add() {
    const lbl = resolvedName;
    if (!lbl) return;
    const codeBase = autoCode(lbl);
    const slugWithPrefix = (p: string) => (codeBase.startsWith(p) ? codeBase : `${p}${codeBase}`);
    const items: PickerItem[] = [];
    const nQty = Number(nights);
    const mQty = Number(miles);
    const hQty = Number(hours);
    if (Number.isFinite(nQty) && nQty > 0) {
      items.push({
        key: `camping_nights:EV:${codeBase}`,
        kind: 'camping_nights',
        code: slugWithPrefix('EV:'),
        label: lbl,
        unit: 'nights',
        qty: nQty
      });
    }
    if (Number.isFinite(mQty) && mQty > 0) {
      items.push({
        key: `hiking_miles:HK:${codeBase}`,
        kind: 'hiking_miles',
        code: slugWithPrefix('HK:'),
        label: lbl,
        unit: 'miles',
        qty: mQty
      });
    }
    if (Number.isFinite(hQty) && hQty > 0) {
      items.push({
        key: `service_hours:SP:${codeBase}`,
        kind: 'service_hours',
        code: slugWithPrefix('SP:'),
        label: lbl,
        unit: 'hours',
        qty: hQty
      });
    }
    // No numbers given — fall back to a single check-in row. Auto-apply the
    // event's classification when it's a no-quantity type; otherwise use
    // whatever Type was picked (the button is disabled until one is).
    if (items.length === 0) {
      const kind = autoKind ?? (eventKind as PickerItem['kind']);
      if (!kind) return;
      items.push({
        key: `${kind}:EV:${codeBase}`,
        kind,
        code: slugWithPrefix('EV:'),
        label: lbl,
        unit: 'event',
        qty: 1
      });
    }

    // Classify (or heal the classification of) the event for next time — a
    // brand-new event, or an existing one that had no stored kind yet.
    const resolvedKindForEvent = items[0]?.kind;
    if (isNew && !names.includes(lbl)) {
      setLocalEvents((prev) => [...prev, lbl]);
      const fd = new FormData();
      fd.set('name', lbl);
      fd.set('default_kind', resolvedKindForEvent ?? '');
      startTransition(() => {
        createEvent(fd);
      });
    } else if (selectedEvent && !storedKind && resolvedKindForEvent) {
      const fd = new FormData();
      fd.set('id', String(selectedEvent.id));
      fd.set('name', selectedEvent.name);
      fd.set('default_kind', resolvedKindForEvent);
      startTransition(() => {
        updateEvent(fd);
      });
    }

    onAdd(items);
    setSelected(isNew ? NEW_EVENT : '');
    setNewName('');
    setNights('');
    setMiles('');
    setHours('');
    setEventKind('');
  }

  return (
    <div className={styles.freeForm}>
      <p className={styles.freeFormHelp}>
        Pick an event from the list (or add a new one). Fill in any of Nights,
        Miles, or Hours — each non-zero value creates a separate ledger row
        (e.g. a 2-night campout with 3 miles of hiking → 2 rows). Every event
        remembers its Type, so a recurring Fundraiser or Day Outing logs
        itself automatically — no numbers, no re-picking.
      </p>
      <label className={styles.field} style={{ marginBottom: 4 }}>
        <span className={styles.fieldLabel}>Event</span>
        <select
          className={styles.select}
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setEventKind('');
          }}
        >
          <option value="">— Select an event —</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={NEW_EVENT}>+ New event…</option>
        </select>
      </label>
      {isNew && (
        <label className={styles.field} style={{ marginBottom: 4 }}>
          <span className={styles.fieldLabel}>New event name</span>
          <input
            type="text"
            className={styles.input}
            placeholder="Spring Campout Greenbush '26"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
        </label>
      )}
      {!isNew && selectedEvent && (
        <p className={styles.freeFormHelp} style={{ marginTop: -2, marginBottom: 8 }}>
          {autoKind
            ? `Classified as ${EVENT_TYPE_LABEL.get(autoKind)} — will log automatically.`
            : storedKind
              ? `Classified as ${EVENT_TYPE_LABEL.get(storedKind)} — fill in ${storedKind === 'camping_nights' ? 'Nights' : 'Miles'} below, or pick a Type if this one wasn't.`
              : 'Not yet classified — pick a Type below (remembered for next time).'}
        </p>
      )}
      {showTypePicker && (
        <label className={styles.field} style={{ marginBottom: 4 }}>
          <span className={styles.fieldLabel}>Type</span>
          <select
            className={styles.select}
            value={eventKind}
            onChange={(e) => setEventKind(e.target.value)}
          >
            <option value="">— Select a type —</option>
            {EVENT_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <label className={styles.field} style={{ marginBottom: 4 }}>
          <span className={styles.fieldLabel}>Nights</span>
          <input
            type="number"
            min="0"
            step="1"
            className={styles.input}
            value={nights}
            onChange={(e) => setNights(e.target.value)}
            placeholder="0"
          />
        </label>
        <label className={styles.field} style={{ marginBottom: 4 }}>
          <span className={styles.fieldLabel}>Miles</span>
          <input
            type="number"
            min="0"
            step="0.5"
            className={styles.input}
            value={miles}
            onChange={(e) => setMiles(e.target.value)}
            placeholder="0"
          />
        </label>
        <label className={styles.field} style={{ marginBottom: 4 }}>
          <span className={styles.fieldLabel}>Hours</span>
          <input
            type="number"
            min="0"
            step="0.5"
            className={styles.input}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="0"
          />
        </label>
      </div>
      <div>
        <button
          type="button"
          className={styles.btn}
          onClick={add}
          disabled={!canSubmit}
        >
          + Add Event
        </button>
      </div>
    </div>
  );
}

/** Service tab — pick a project from the lookup (or add a new one) + Hours. */
function ServiceTab({
  projects,
  onAdd
}: {
  projects: { id: number; name: string }[];
  onAdd: (item: PickerItem) => void;
}) {
  const [selected, setSelected] = useState('');
  const [newName, setNewName] = useState('');
  const [localNames, setLocalNames] = useState<string[]>([]);
  const [hours, setHours] = useState('2');
  const [, startTransition] = useTransition();

  const names = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) set.add(p.name);
    for (const n of localNames) set.add(n);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [projects, localNames]);

  const isNew = selected === NEW_EVENT;
  const resolvedName = (isNew ? newName : selected).trim();

  function add() {
    const lbl = resolvedName;
    if (!lbl) return;
    if (isNew && !names.includes(lbl)) {
      setLocalNames((prev) => [...prev, lbl]);
      const fd = new FormData();
      fd.set('name', lbl);
      startTransition(() => {
        createServiceProject(fd);
      });
    }
    const codeBase = autoCode(lbl);
    const code = codeBase.startsWith('SP:') ? codeBase : `SP:${codeBase}`;
    const hQty = Number(hours);
    onAdd({
      key: `service_hours:${code}`,
      kind: 'service_hours',
      code,
      label: lbl,
      unit: 'hours',
      qty: Number.isFinite(hQty) && hQty > 0 ? hQty : 2
    });
    setSelected(isNew ? NEW_EVENT : '');
    setNewName('');
    setHours('2');
  }

  return (
    <div className={styles.freeForm}>
      <p className={styles.freeFormHelp}>
        Pick a service project from the list (or add a new one). Hours defaults
        to 2 per troop convention; adjust for actual time.
      </p>
      <label className={styles.field} style={{ marginBottom: 4 }}>
        <span className={styles.fieldLabel}>Service project</span>
        <select
          className={styles.select}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">— Select a project —</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={NEW_EVENT}>+ New project…</option>
        </select>
      </label>
      {isNew && (
        <label className={styles.field} style={{ marginBottom: 4 }}>
          <span className={styles.fieldLabel}>New project name</span>
          <input
            type="text"
            className={styles.input}
            placeholder="OLT Cleanup Apr '26"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
        </label>
      )}
      <label className={styles.field} style={{ marginBottom: 4 }}>
        <span className={styles.fieldLabel}>Hours</span>
        <input
          type="number"
          min="0.5"
          step="0.5"
          className={styles.input}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
      </label>
      <div>
        <button
          type="button"
          className={styles.btn}
          onClick={add}
          disabled={!resolvedName}
        >
          + Add Service
        </button>
      </div>
    </div>
  );
}

function HistoryPanel({
  rows,
  onUndo
}: {
  rows: HistoryRow[];
  onUndo?: (entryId: number) => void;
}) {
  const [, startTransition] = useTransition();
  function handleUndo(row: HistoryRow) {
    const reason = window.prompt(
      `"${row.label ?? row.code}" was logged${row.date ? ' on ' + row.date : ''}${row.by ? ' by ' + row.by : ''}.\n\nRemove this entry? Enter a reason (required — duplicate, wrong scout, etc.).`,
      ''
    );
    if (reason === null) return;
    const r = reason.trim();
    if (!r) {
      window.alert('Removal cancelled — a reason is required.');
      return;
    }
    const fd = new FormData();
    fd.set('id', String(row.id));
    fd.set('reason', r);
    startTransition(async () => {
      const res = await undoCompletion(fd);
      if (!res.ok) {
        window.alert(`Failed: ${res.error}`);
        return;
      }
      onUndo?.(row.id);
    });
  }
  if (rows.length === 0) {
    return (
      <div className={styles.historyEmpty}>
        No prior entries for this scout in this category.
      </div>
    );
  }
  return (
    <div className={styles.historyPanel}>
      <div className={styles.historyHeader}>History ({rows.length})</div>
      {rows.map((r) => (
        <div key={r.id} className={styles.historyRow}>
          <span className={styles.historyDate}>{r.date ?? '—'}</span>
          <span className={styles.historyLabel}>{r.label ?? r.code}</span>
          <span className={styles.historyQty}>
            {r.qty} {r.unit}
          </span>
          <span className={styles.historyBy}>{r.by ?? ''}</span>
          <button
            type="button"
            className={styles.historyUndoBtn}
            onClick={() => handleUndo(r)}
            title="Remove (asks for reason)"
            aria-label="Remove"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function autoCode(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
