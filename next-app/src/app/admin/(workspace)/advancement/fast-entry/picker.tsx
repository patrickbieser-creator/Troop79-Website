'use client';

import { useMemo, useState, useTransition } from 'react';
import { undoCompletion } from './actions';
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
  /** Optional history for the Service/Events/Leadership tabs. Scout-First
   *  card supplies this when a scout is selected. */
  history?: {
    service: HistoryRow[];
    events: HistoryRow[];
    leadership: HistoryRow[];
  };
  /** Called when the user undoes a history row. */
  onHistoryRemoved?: (entryId: number) => void;
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
  history,
  onHistoryRemoved
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

  return (
    <div className={styles.picker}>
      {/* Top pending summary — visible across all tabs */}
      {multi && selections.length > 0 && (
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
            onPick={setActiveMbId}
          />
        )}

        {/* MB drill-in */}
        {inMbDetail && activeMbId && (
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
            <EventsTab onAdd={(items) => onSelectionsChange([...selections, ...items])} />
            <HistoryPanel rows={history?.events ?? []} onUndo={onHistoryRemoved} />
          </>
        )}
        {freeTab?.id === 'service' && (
          <>
            <ServiceTab onAdd={(item) => onSelectionsChange([...selections, item])} />
            <HistoryPanel rows={history?.service ?? []} onUndo={onHistoryRemoved} />
          </>
        )}
        {freeTab?.id === 'leadership' && (
          <>
            <FreeFormTab
              kind="leadership"
              placeholder="Patrol Leader"
              onAdd={(item) => onSelectionsChange([...selections, item])}
            />
            <HistoryPanel rows={history?.leadership ?? []} onUndo={onHistoryRemoved} />
          </>
        )}
      </div>

      {/* Detailed pending list at bottom (Scout-First only) */}
      {multi && selections.length > 0 && (
        <div className={styles.selectedList}>
          {selections.map((s) => (
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
  onPick
}: {
  mbs: CatalogPayload['mbs'];
  search: string;
  onPick: (id: string) => void;
}) {
  const q = search.trim().toLowerCase();
  const filtered = q ? mbs.filter((m) => m.name.toLowerCase().includes(q)) : mbs;
  return (
    <div className={styles.mbCatalogGrid}>
      {filtered.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`${styles.mbCatalogItem} ${m.eagle ? styles.mbCatalogItemEagle : ''}`.trim()}
          onClick={() => onPick(m.id)}
        >
          {m.name}
        </button>
      ))}
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
    // Smart select: walk the tree and top off each parent to its target N
    // (counting completed + already-pending toward the target).
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
    onSelectionsChange(newSelections);
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

function ReqTreeRender({
  nodes,
  keyForCode,
  depth,
  search,
  completion,
  statusFor,
  onLeafClick
}: {
  nodes: ReqTreeNode[];
  keyForCode: (code: string) => string;
  depth: number;
  search: string;
  completion: CompletionMap;
  statusFor: (item: PickerItem) => 'empty' | 'pending' | 'completed';
  onLeafClick: (node: ReqTreeNode) => void;
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
  onLeafClick
}: {
  node: ReqTreeNode;
  keyForCode: (code: string) => string;
  depth: number;
  search: string;
  completion: CompletionMap;
  statusFor: (item: PickerItem) => 'empty' | 'pending' | 'completed';
  onLeafClick: (node: ReqTreeNode) => void;
}) {
  const hasChildren = node.children.length > 0;
  const indent = depth * 18;
  if (hasChildren) {
    const target = targetN(node);
    const satCount = countDirectSat(node, keyForCode, completion);
    const optLabel = optionalityLabel(node);
    const satisfied = satCount >= target;
    return (
      <>
        <div
          className={styles.parentHeader}
          style={{ paddingLeft: 8 + indent }}
        >
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
        <ReqTreeRender
          nodes={node.children}
          keyForCode={keyForCode}
          depth={depth + 1}
          search={search}
          completion={completion}
          statusFor={statusFor}
          onLeafClick={onLeafClick}
        />
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

function ItemRow({
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
 * Inline form for Service / Events / Leadership tabs — adds an ad-hoc
 * PickerItem to selections. (History panel comes in F4.)
 */
function FreeFormTab({
  kind,
  placeholder,
  onAdd
}: {
  kind: 'service_hours' | 'attendance' | 'leadership';
  placeholder: string;
  onAdd: (item: PickerItem) => void;
}) {
  const [label, setLabel] = useState('');
  const [code, setCode] = useState('');

  function add() {
    const lbl = label.trim();
    if (!lbl) return;
    const c = code.trim() || autoCode(lbl);
    const prefix =
      kind === 'service_hours' ? 'SP:' : kind === 'attendance' ? 'EV:' : 'LE:';
    const finalCode = c.startsWith(prefix) ? c : `${prefix}${c}`;
    onAdd({
      key: `${kind}:${finalCode}`,
      kind,
      code: finalCode,
      label: lbl,
      unit: kind === 'service_hours' ? 'hours' : kind === 'attendance' ? 'event' : 'term'
    });
    setLabel('');
    setCode('');
  }

  return (
    <div className={styles.freeForm}>
      <p className={styles.freeFormHelp}>
        Add an ad-hoc{' '}
        {kind === 'service_hours'
          ? 'service project'
          : kind === 'attendance'
            ? 'event'
            : 'leadership term'}
        . Type the title and hit Add — it appears in the pending list and
        saves when you hit Save.
      </p>
      <label className={styles.field} style={{ marginBottom: 4 }}>
        <span className={styles.fieldLabel}>Title</span>
        <input
          type="text"
          className={styles.input}
          placeholder={placeholder}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label className={styles.field} style={{ marginBottom: 4 }}>
        <span className={styles.fieldLabel}>Code (optional)</span>
        <input
          type="text"
          className={styles.input}
          placeholder={`auto-derived from title if blank`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <div>
        <button
          type="button"
          className={styles.btn}
          onClick={add}
          disabled={!label.trim()}
        >
          + Add
        </button>
      </div>
    </div>
  );
}

/**
 * Events tab — title + optional Nights / Miles / Hours. Each non-zero number
 * creates a separate pending row of the matching kind, so a 2-night campout
 * with a 3-mile hike becomes two rows in the ledger.
 */
function EventsTab({ onAdd }: { onAdd: (items: PickerItem[]) => void }) {
  const [title, setTitle] = useState('');
  const [nights, setNights] = useState('');
  const [miles, setMiles] = useState('');
  const [hours, setHours] = useState('');

  function add() {
    const lbl = title.trim();
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
    // If no numbers were provided, fall back to a plain attendance row so the
    // event is still tracked (e.g. a pancake breakfast with no nights/miles).
    if (items.length === 0) {
      items.push({
        key: `attendance:EV:${codeBase}`,
        kind: 'attendance',
        code: slugWithPrefix('EV:'),
        label: lbl,
        unit: 'event',
        qty: 1
      });
    }
    onAdd(items);
    setTitle('');
    setNights('');
    setMiles('');
    setHours('');
  }

  return (
    <div className={styles.freeForm}>
      <p className={styles.freeFormHelp}>
        Add a troop event. Fill in any of Nights, Miles, or Hours — each non-zero
        value creates a separate ledger row (e.g. a 2-night campout with 3 miles
        of hiking → 2 rows). Title-only with no numbers creates a plain
        attendance row.
      </p>
      <label className={styles.field} style={{ marginBottom: 4 }}>
        <span className={styles.fieldLabel}>Event title</span>
        <input
          type="text"
          className={styles.input}
          placeholder="Spring Campout Greenbush '26"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
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
          disabled={!title.trim()}
        >
          + Add Event
        </button>
      </div>
    </div>
  );
}

/** Service tab — title + Hours. One service_hours row per add. */
function ServiceTab({ onAdd }: { onAdd: (item: PickerItem) => void }) {
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState('2');

  function add() {
    const lbl = title.trim();
    if (!lbl) return;
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
    setTitle('');
    setHours('2');
  }

  return (
    <div className={styles.freeForm}>
      <p className={styles.freeFormHelp}>
        Add a service project. Hours defaults to 2 per troop convention; adjust
        for actual time.
      </p>
      <label className={styles.field} style={{ marginBottom: 4 }}>
        <span className={styles.fieldLabel}>Project title</span>
        <input
          type="text"
          className={styles.input}
          placeholder="OLT Cleanup Apr '26"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
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
          disabled={!title.trim()}
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
