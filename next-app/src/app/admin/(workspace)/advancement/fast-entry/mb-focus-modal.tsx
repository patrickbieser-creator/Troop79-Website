'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { addLedgerEntries, undoCompletion } from './actions';
import {
  ItemRow,
  ReqTreeRender,
  collectMbGroupKeys,
  computeMbSmartSelect,
  mbHasPending
} from './picker';
import { nodeSatisfied } from './satisfaction';
import {
  itemKey,
  mbAwardItem,
  mbReqItem,
  type CatalogPayload,
  type Completion,
  type CompletionMap,
  type PickerItem
} from './picker-types';
import styles from './fast-entry.module.css';

interface Props {
  /** The badge to focus on. `null` closes the modal. */
  mb: CatalogPayload['mbs'][number] | null;
  scoutId: string;
  scoutName: string;
  leaders: { code: string; name: string }[];
  /** Seed values from the parent card; editable inside the modal. */
  defaultDate: string;
  defaultBy: string;
  /** This scout's completion overlay (drives green checks + award gating). */
  completion: CompletionMap;
  onClose: () => void;
  /** Parent removes the undone key from its completion map + refreshes. */
  onCompletionRemoved: (key: string) => void;
  /** Parent applies the optimistic completion update, toasts, and refreshes. */
  onSaved: (items: PickerItem[], date: string, by: string) => void;
}

/**
 * Scout-First merit-badge entry, given room to breathe. Opening a badge from
 * the catalog focuses it in a wide two-pane modal: the requirement tree on the
 * left, a live "selected" tally on the right. Saving commits that badge's
 * ticked requirements directly (direct-save model) via `addLedgerEntries`,
 * then hands the saved items back to the parent for the optimistic overlay
 * update. Ranks / Service / Events stay inline in the card — only MB entry
 * uses this modal.
 */
export function MbFocusModal({
  mb,
  scoutId,
  scoutName,
  leaders,
  defaultDate,
  defaultBy,
  completion,
  onClose,
  onCompletionRemoved,
  onSaved
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<PickerItem[]>([]);
  const [date, setDate] = useState(defaultDate);
  const [by, setBy] = useState(defaultBy);
  const [search, setSearch] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  // Open/close the native dialog to match `mb`. Per-badge state reset is
  // handled by the parent remounting this component via `key` (so opening a
  // fresh badge starts clean, re-seeding date/by from the card's initial
  // useState values above).
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (mb && !dlg.open) dlg.showModal();
    if (!mb && dlg.open) dlg.close();
  }, [mb]);

  const selectedKeys = new Set(selected.map((s) => s.key));

  function statusFor(item: PickerItem): 'empty' | 'pending' | 'completed' {
    if (completion.has(item.key)) return 'completed';
    if (selectedKeys.has(item.key)) return 'pending';
    return 'empty';
  }

  function toggleItem(item: PickerItem) {
    const status = statusFor(item);
    if (status === 'completed') {
      promptUndo(item, completion.get(item.key)!);
      return;
    }
    setNotice(null);
    if (status === 'pending') {
      setSelected((prev) => prev.filter((s) => s.key !== item.key));
    } else {
      setSelected((prev) => [...prev, item]);
    }
  }

  function toggleCollapse(key: string) {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
        setErr(res.error ?? 'Undo failed');
        return;
      }
      onCompletionRemoved(item.key);
    });
  }

  function removeSelected(key: string) {
    setNotice(null);
    setSelected((prev) => prev.filter((s) => s.key !== key));
  }

  function attemptClose() {
    if (selected.length > 0) {
      setErr('You have unsaved selections — Save them, or use Cancel to discard.');
      return;
    }
    onClose();
  }

  function save(closeAfter: boolean) {
    if (!mb) return;
    if (selected.length === 0) {
      setErr('Tick at least one requirement.');
      return;
    }
    if (!date || !by) {
      setErr('Date and Signed-Off By are required.');
      return;
    }
    const items = selected.map((s) => ({
      scout_id: scoutId,
      kind: s.kind,
      code: s.code,
      label: s.label,
      unit: s.unit,
      qty: s.qty
    }));
    const fd = new FormData();
    fd.set('date', date);
    fd.set('by', by);
    fd.set('notes', '');
    fd.set('items', JSON.stringify(items));
    const saved = selected;
    const count = saved.length;
    setErr(null);

    startTransition(async () => {
      const res = await addLedgerEntries(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Save failed');
        return;
      }
      setSelected([]);
      // Parent applies the optimistic overlay update + reconciles from the
      // server; it no longer closes the modal, so "keep going" can stay open.
      onSaved(saved, date, by);
      if (closeAfter) {
        onClose();
      } else {
        setNotice(
          `Saved ${count} entr${count === 1 ? 'y' : 'ies'} — badge updated. Tick more or close.`
        );
      }
    });
  }

  // Derived values (only meaningful when a badge is open).
  const keyFor = (code: string) => itemKey.mbReq(mb?.id ?? '', code);
  const hasKey = (k: string) => completion.has(k) || selectedKeys.has(k);
  const topSat = mb
    ? mb.requirements.filter((t) => nodeSatisfied(t, keyFor, hasKey)).length
    : 0;
  const topTotal = mb?.requirements.length ?? 0;
  const awardBlocked = topTotal > 0 && topSat < topTotal;
  const awardItem = mb ? mbAwardItem(mb.id, mb.name, mb.eagle) : null;
  const awardStatus = awardItem ? statusFor(awardItem) : 'empty';
  const hasPending = mb ? mbHasPending(mb, selected) : false;
  const groupKeys = mb ? collectMbGroupKeys(mb) : [];
  const allCollapsed =
    groupKeys.length > 0 && groupKeys.every((k) => collapsedKeys.has(k));
  const canSave = selected.length > 0 && !!date && !!by && !isPending;

  return (
    <dialog
      ref={dialogRef}
      className={styles.mbModal}
      onClose={onClose}
      onCancel={(e) => {
        // Esc — guard unsaved ticks without a native confirm dialog.
        if (selected.length > 0) {
          e.preventDefault();
          setErr('You have unsaved selections — Save them, or use Cancel to discard.');
        }
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) attemptClose();
      }}
      onKeyDown={(e) => {
        // Ctrl/Cmd+Enter → Save & Close (works from anywhere in the modal).
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          if (canSave) save(true);
        }
      }}
    >
      {mb && awardItem && (
        <div className={styles.mbModalInner}>
          {/* Header */}
          <div className={styles.mbModalHeader}>
            <div className={styles.mbModalTitle}>
              <span className={styles.mbModalBadge}>{mb.name}</span>
              {mb.eagle && <span className={styles.mbEagleTag}>Eagle ★</span>}
              <span className={styles.mbModalScout}>for {scoutName}</span>
            </div>
            <button
              type="button"
              className={styles.mbModalClose}
              onClick={attemptClose}
              aria-label="Close"
              title="Close"
            >
              ×
            </button>
          </div>

          {/* Date + Signed-off By */}
          <div className={styles.mbModalMeta}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Date Completed</span>
              <input
                type="date"
                className={styles.input}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Signed Off By</span>
              <select
                className={styles.select}
                value={by}
                onChange={(e) => setBy(e.target.value)}
              >
                <option value="">— Leader —</option>
                {leaders.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.code} — {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Two panes */}
          <div className={styles.mbModalPanes}>
            {/* Left: requirement tree */}
            <div className={styles.mbModalTreeCol}>
              <div className={styles.mbModalTreeTools}>
                <input
                  type="search"
                  className={styles.mbModalSearch}
                  placeholder="Filter requirements…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {groupKeys.length > 0 && (
                  <button
                    type="button"
                    className={styles.mbModalToolBtn}
                    onClick={() =>
                      setCollapsedKeys(allCollapsed ? new Set() : new Set(groupKeys))
                    }
                    title={
                      allCollapsed
                        ? 'Expand all requirement groups'
                        : 'Collapse all requirement groups'
                    }
                  >
                    {allCollapsed ? 'Expand all' : 'Collapse all'}
                  </button>
                )}
                <button
                  type="button"
                  className={styles.selectAllBtn}
                  onClick={() => {
                    setNotice(null);
                    if (hasPending) {
                      setSelected((prev) =>
                        prev.filter(
                          (s) =>
                            !(
                              s.kind === 'merit_badge_requirement' &&
                              s.code.startsWith(`${mb.id}-`)
                            )
                        )
                      );
                    } else {
                      setSelected(computeMbSmartSelect(mb, completion, selected));
                    }
                  }}
                >
                  {hasPending ? 'Clear pending' : 'Select all'}
                </button>
              </div>

              <div className={styles.mbModalTreeScroll}>
                {/* Award (★) row — gated until every requirement group is met */}
                <ItemRow
                  item={awardItem}
                  status={awardStatus}
                  completion={completion.get(awardItem.key) ?? null}
                  codeDisplay="★"
                  label={
                    awardBlocked && awardStatus !== 'completed'
                      ? `Full merit badge earned — ${topSat} of ${topTotal} requirement groups met`
                      : `Full merit badge earned${mb.eagle ? ' (Eagle)' : ''}`
                  }
                  onClick={() => {
                    if (awardBlocked && awardStatus !== 'completed') {
                      setErr(
                        `Can't mark ${mb.name} earned yet — ${topSat} of ${topTotal} requirement groups met (completed + ticked).`
                      );
                      return;
                    }
                    toggleItem(awardItem);
                  }}
                  isAward
                />

                {mb.requirements.length === 0 ? (
                  <div className={styles.pickerEmpty}>
                    No requirements authored for this merit badge yet. Add them
                    via Lookups &amp; Admin → Merit Badge Catalog → Edit.
                  </div>
                ) : (
                  <ReqTreeRender
                    nodes={mb.requirements}
                    keyForCode={keyFor}
                    depth={0}
                    search={search.trim().toLowerCase()}
                    completion={completion}
                    statusFor={statusFor}
                    onLeafClick={(node) =>
                      toggleItem(mbReqItem(mb.id, mb.name, node.code, node.label))
                    }
                    collapsedKeys={collapsedKeys}
                    onToggleCollapse={toggleCollapse}
                  />
                )}
              </div>
            </div>

            {/* Right: live selected tally */}
            <div className={styles.mbModalSelectedCol}>
              <div className={styles.mbModalSelectedHead}>
                Selected ({selected.length})
              </div>
              <div className={styles.mbModalProgress}>
                {topTotal > 0
                  ? `${topSat} of ${topTotal} requirement groups met (completed + ticked)`
                  : 'This badge has no authored requirement groups.'}
              </div>
              <div className={styles.mbModalSelectedScroll}>
                {selected.length === 0 ? (
                  <div className={styles.mbModalSelectedEmpty}>
                    Nothing ticked yet. Click requirements on the left to add
                    them here.
                  </div>
                ) : (
                  selected.map((s) => (
                    <div key={s.key} className={styles.mbSelRow}>
                      <span className={styles.selectedCode}>
                        {s.kind === 'merit_badge_award'
                          ? '★'
                          : s.code.replace(`${mb.id}-`, '')}
                      </span>
                      <span className={styles.mbSelLabel}>{s.label}</span>
                      <button
                        type="button"
                        className={styles.selectedRemove}
                        onClick={() => removeSelected(s.key)}
                        aria-label="Remove"
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className={styles.mbModalFooter}>
            {err ? (
              <span className={styles.statusErr}>{err}</span>
            ) : notice ? (
              <span className={styles.statusOk}>{notice}</span>
            ) : (
              <span className={styles.mbModalHint}>⌘/Ctrl + Enter to save</span>
            )}
            <button
              type="button"
              className={styles.btn}
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={() => save(false)}
              disabled={!canSave}
              title={
                selected.length === 0
                  ? 'Tick at least one requirement'
                  : 'Save and keep this badge open to add more'
              }
            >
              {isPending ? 'Saving…' : 'Save & keep going'}
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => save(true)}
              disabled={!canSave}
              title={
                selected.length === 0
                  ? 'Tick at least one requirement'
                  : !date
                    ? 'Date is required'
                    : !by
                      ? 'Signed-Off By is required'
                      : undefined
              }
            >
              {isPending
                ? 'Saving…'
                : selected.length > 0
                  ? `Save & Close (${selected.length})`
                  : 'Save & Close'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
