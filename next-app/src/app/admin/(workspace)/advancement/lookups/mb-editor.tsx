'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { updateMeritBadge } from './actions';
import { SortableList } from '../../_components/sortable-list';
import styles from './lookups.module.css';

export interface MbRow {
  id: string;
  name: string;
  eagle: boolean;
  scoutbook_id: string | null;
  bsa_page_url: string | null;
  workbook_url: string | null;
}

export interface CounselorRow {
  mb_id: string;
  leader_code: string;
  sort_order: number;
}

export interface EditReqNode {
  /** Present for existing DB rows; missing for newly-added rows. */
  id?: number;
  code: string;
  /** Snapshot of the code as loaded — used to detect renames at save time. */
  originalCode?: string;
  label: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
  children: EditReqNode[];
}

interface LeaderLite {
  code: string;
  name: string;
}

interface Props {
  rows: MbRow[];
  leaders: LeaderLite[];
  counselorsByMb: Map<string, CounselorRow[]>;
  reqTreesByMb: Map<string, EditReqNode[]>;
}

export function MbEditor({ rows, leaders, counselorsByMb, reqTreesByMb }: Props) {
  const [openFor, setOpenFor] = useState<MbRow | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const leaderNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leaders) m.set(l.code, l.name);
    return m;
  }, [leaders]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (openFor && !dlg.open) dlg.showModal();
    if (!openFor && dlg.open) dlg.close();
  }, [openFor]);

  return (
    <>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>ID</th>
            <th>Eagle?</th>
            <th>Counselors</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const cs = counselorsByMb.get(m.id) ?? [];
            return (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td className={styles.codeCell}>{m.id}</td>
                <td>
                  {m.eagle ? (
                    <span className={`${styles.tag} ${styles.tagEagle}`}>Eagle ★</span>
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td>
                  {cs.length === 0 ? (
                    <span className={styles.muted}>—</span>
                  ) : (
                    <span style={{ fontSize: 12 }}>
                      {cs
                        .map(
                          (c) =>
                            leaderNameByCode.get(c.leader_code) ?? c.leader_code
                        )
                        .join(', ')}
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className={styles.editBtn}
                    onClick={() => setOpenFor(m)}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dialog
        ref={dialogRef}
        className={`${styles.editDialog} ${styles.editDialogLarge}`}
        onClose={() => setOpenFor(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpenFor(null);
        }}
      >
        {openFor && (
          <MbForm
            row={openFor}
            initialCounselors={counselorsByMb.get(openFor.id) ?? []}
            initialReqs={reqTreesByMb.get(openFor.id) ?? []}
            leaders={leaders}
            onClose={() => setOpenFor(null)}
          />
        )}
      </dialog>
    </>
  );
}

interface CounselorItem {
  key: string; // leader_code
  label: string;
}

function MbForm({
  row,
  initialCounselors,
  initialReqs,
  leaders,
  onClose
}: {
  row: MbRow;
  initialCounselors: CounselorRow[];
  initialReqs: EditReqNode[];
  leaders: LeaderLite[];
  onClose: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [eagle, setEagle] = useState(row.eagle);
  const [scoutbookId, setScoutbookId] = useState(row.scoutbook_id ?? '');
  const [bsaPageUrl, setBsaPageUrl] = useState(row.bsa_page_url ?? '');
  const [workbookUrl, setWorkbookUrl] = useState(row.workbook_url ?? '');
  const [reqTree, setReqTree] = useState<EditReqNode[]>(initialReqs);

  const leaderItemByCode = useMemo(() => {
    const m = new Map<string, CounselorItem>();
    for (const l of leaders) {
      m.set(l.code, { key: l.code, label: `${l.code} — ${l.name}` });
    }
    return m;
  }, [leaders]);

  const allLeaderItems: CounselorItem[] = useMemo(
    () => leaders.map((l) => ({ key: l.code, label: `${l.code} — ${l.name}` })),
    [leaders]
  );

  const initialItems: CounselorItem[] = useMemo(() => {
    const sorted = initialCounselors.slice().sort((a, b) => a.sort_order - b.sort_order);
    return sorted
      .map((c) => leaderItemByCode.get(c.leader_code))
      .filter((x): x is CounselorItem => !!x);
  }, [initialCounselors, leaderItemByCode]);

  const [counselors, setCounselors] = useState<CounselorItem[]>(initialItems);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setErr(null);
    const fd = new FormData();
    fd.set('id', row.id);
    fd.set('name', name);
    fd.set('eagle', eagle ? 'true' : 'false');
    fd.set('scoutbook_id', scoutbookId);
    fd.set('bsa_page_url', bsaPageUrl);
    fd.set('workbook_url', workbookUrl);
    fd.set(
      'counselors',
      JSON.stringify(counselors.map((c) => ({ leader_code: c.key })))
    );
    fd.set('reqTree', JSON.stringify(reqTree));
    startTransition(async () => {
      const res = await updateMeritBadge(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Save failed');
        return;
      }
      onClose();
    });
  }

  return (
    <div className={styles.editDialogInner}>
      <div className={styles.editDialogHeader}>
        <h3>Edit merit badge — {row.name}</h3>
        <p>
          Catalog id <code>{row.id}</code> is permanent. Counselors here are
          shown in the order set below — that order also flows to other
          editors that link to this badge.
        </p>
      </div>

      <div className={styles.editSection}>
        <div className={styles.editSectionHeader}>
          <h4>Catalog</h4>
        </div>
        <div className={styles.editGrid}>
          <label className={styles.editField}>
            <span className={styles.editLabel}>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={styles.editInput}
              required
            />
          </label>
          <label className={styles.editField}>
            <span className={styles.editLabel}>Scoutbook ID</span>
            <input
              type="text"
              value={scoutbookId}
              onChange={(e) => setScoutbookId(e.target.value)}
              className={`${styles.editInput} ${styles.editInputMono}`}
              placeholder="(numeric, optional)"
            />
          </label>
          <div className={styles.editFieldFull}>
            <span className={styles.editLabel}>Eagle Required</span>
            <label className={styles.toggleRow}>
              <input
                type="checkbox"
                checked={eagle}
                onChange={(e) => setEagle(e.target.checked)}
              />
              <span>This is an Eagle-required merit badge</span>
            </label>
          </div>
          <label className={styles.editFieldFull}>
            <span className={styles.editLabel}>BSA Page URL</span>
            <input
              type="url"
              value={bsaPageUrl}
              onChange={(e) => setBsaPageUrl(e.target.value)}
              className={styles.editInput}
              placeholder="https://www.scouting.org/merit-badges/…"
            />
          </label>
          <label className={styles.editFieldFull}>
            <span className={styles.editLabel}>Workbook URL</span>
            <input
              type="url"
              value={workbookUrl}
              onChange={(e) => setWorkbookUrl(e.target.value)}
              className={styles.editInput}
              placeholder="https://meritbadge.org/wiki/…"
            />
          </label>
        </div>
      </div>

      <div className={styles.editSection}>
        <div className={styles.editSectionHeader}>
          <h4>Counselors</h4>
        </div>
        <p className={styles.helpText} style={{ marginBottom: 8 }}>
          Pick one or more adult leaders who are registered counselors for this
          badge. Use ▲ / ▼ to set the display order (the first counselor is
          shown first on scout-facing screens).
        </p>
        <SortableList
          items={counselors}
          onChange={setCounselors}
          available={allLeaderItems}
          addLabel="Add a counselor"
          emptyLabel="No counselors assigned yet."
        />
      </div>

      <div className={styles.editSection}>
        <div className={styles.editSectionHeader}>
          <h4>Requirements</h4>
          <button
            type="button"
            className={styles.addBtn}
            onClick={() =>
              setReqTree((prev) => [
                ...prev,
                {
                  code: '',
                  label: '',
                  complete_rule: 'all',
                  complete_n: null,
                  children: []
                }
              ])
            }
          >
            + Add top-level
          </button>
        </div>
        <p className={styles.helpText} style={{ marginBottom: 8 }}>
          Edit codes, labels, and optionality (Complete all / any / N-of) for
          this badge&rsquo;s requirements. Add child rows for sub-requirements;
          unlimited depth supported. Renaming a code is refused if active
          ledger rows reference the old code &mdash; archive those entries
          first.
        </p>
        <ReqTreeEditor tree={reqTree} onChange={setReqTree} depth={0} />
      </div>

      {err && <div className={styles.editError}>{err}</div>}

      <div className={styles.editActions}>
        <button
          type="button"
          className={styles.editBtn}
          onClick={onClose}
          disabled={isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.editSaveBtn}
          onClick={submit}
          disabled={isPending || !name.trim()}
        >
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// ── Requirement tree editor (recursive) ─────────────────────────────────

function ReqTreeEditor({
  tree,
  onChange,
  depth
}: {
  tree: EditReqNode[];
  onChange: (next: EditReqNode[]) => void;
  depth: number;
}) {
  function updateAt(i: number, patch: Partial<EditReqNode>) {
    onChange(tree.map((n, idx) => (idx === i ? { ...n, ...patch } : n)));
  }
  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= tree.length) return;
    const next = tree.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  function remove(i: number) {
    onChange(tree.filter((_, idx) => idx !== i));
  }
  function addChild(i: number) {
    onChange(
      tree.map((n, idx) =>
        idx === i
          ? {
              ...n,
              children: [
                ...n.children,
                {
                  code: '',
                  label: '',
                  complete_rule: 'all',
                  complete_n: null,
                  children: []
                }
              ]
            }
          : n
      )
    );
  }
  function setChildren(i: number, next: EditReqNode[]) {
    onChange(tree.map((n, idx) => (idx === i ? { ...n, children: next } : n)));
  }
  if (tree.length === 0 && depth === 0) {
    return (
      <div className={styles.editEmpty}>
        No requirements yet. Click <strong>+ Add top-level</strong> above to start.
      </div>
    );
  }
  return (
    <div className={styles.reqTree}>
      {tree.map((node, i) => (
        <div key={i} className={styles.reqTreeBranch} style={{ marginLeft: depth * 16 }}>
          <div className={styles.reqTreeRow}>
            <input
              type="text"
              value={node.code}
              onChange={(e) => updateAt(i, { code: e.target.value })}
              className={`${styles.editInput} ${styles.editInputMono} ${styles.reqCodeInput}`}
              placeholder="code"
            />
            <input
              type="text"
              value={node.label}
              onChange={(e) => updateAt(i, { label: e.target.value })}
              className={`${styles.editInput} ${styles.reqLabelInput}`}
              placeholder="Short description"
            />
            <select
              value={node.complete_rule}
              onChange={(e) =>
                updateAt(i, {
                  complete_rule: e.target.value as EditReqNode['complete_rule'],
                  complete_n:
                    e.target.value === 'n-of' ? node.complete_n ?? 2 : null
                })
              }
              className={`${styles.editInput} ${styles.reqRuleInput}`}
              title="Completion rule"
            >
              <option value="all">All</option>
              <option value="any">Any</option>
              <option value="n-of">N of</option>
            </select>
            {node.complete_rule === 'n-of' && (
              <input
                type="number"
                min="1"
                value={node.complete_n ?? ''}
                onChange={(e) =>
                  updateAt(i, {
                    complete_n: e.target.value === '' ? null : Number(e.target.value)
                  })
                }
                className={`${styles.editInput} ${styles.reqNInput}`}
                placeholder="N"
              />
            )}
            <div className={styles.reqRowControls}>
              <button
                type="button"
                className={styles.reqIconBtn}
                onClick={() => move(i, -1)}
                disabled={i === 0}
                title="Move up"
              >
                ▲
              </button>
              <button
                type="button"
                className={styles.reqIconBtn}
                onClick={() => move(i, +1)}
                disabled={i === tree.length - 1}
                title="Move down"
              >
                ▼
              </button>
              <button
                type="button"
                className={styles.reqIconBtn}
                onClick={() => addChild(i)}
                title="Add child"
              >
                +
              </button>
              <button
                type="button"
                className={`${styles.reqIconBtn} ${styles.dangerBtn}`}
                onClick={() => remove(i)}
                title="Remove (and all children)"
              >
                ×
              </button>
            </div>
          </div>
          {node.children.length > 0 && (
            <ReqTreeEditor
              tree={node.children}
              onChange={(next) => setChildren(i, next)}
              depth={depth + 1}
            />
          )}
        </div>
      ))}
    </div>
  );
}
