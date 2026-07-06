'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { addLedgerEntries, loadScoutCompletion, loadScoutHistory } from './actions';
import { RequirementPicker, type HistoryRow } from './picker';
import { MbFocusModal } from './mb-focus-modal';
import {
  mbAwardItem,
  mbReqItem,
  type CatalogPayload,
  type CompletionMap,
  type PickerItem
} from './picker-types';
import { validateAwards } from './satisfaction';
import styles from './fast-entry.module.css';

interface Props {
  scouts: { id: string; display_name: string; current_rank: string | null }[];
  leaders: { code: string; name: string }[];
  catalog: CatalogPayload;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ScoutFirstCard({ scouts, leaders, catalog }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [scoutId, setScoutId] = useState('');
  const [date, setDate] = useState(todayISO);
  const [by, setBy] = useState('');
  const [notes, setNotes] = useState('');
  const [selections, setSelections] = useState<PickerItem[]>([]);
  const [completion, setCompletion] = useState<CompletionMap>(new Map());
  const [history, setHistory] = useState<{
    service: HistoryRow[];
    events: HistoryRow[];
    leadership: HistoryRow[];
  }>({ service: [], events: [], leadership: [] });
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [loadingCompletion, setLoadingCompletion] = useState(false);
  const [openMbId, setOpenMbId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Prefill from URL: ?scout=A01&mb=cooking&req=2a (from MB Progress cells) or
  // ?scout=A01&mb=cooking&req=AWARD (from the badge-earned cell). Drops these
  // params after applying so a refresh doesn't re-apply on an already-saved
  // entry.
  useEffect(() => {
    const sid = searchParams.get('scout');
    const mbId = searchParams.get('mb');
    const reqCode = searchParams.get('req');
    if (!sid || !mbId || !reqCode) return;
    // Find the catalog entry for this MB.
    const mb = catalog.mbs.find((m) => m.id === mbId);
    if (!mb) return;
    // Build the PickerItem we'll preselect.
    let item: PickerItem | null = null;
    if (reqCode === 'AWARD') {
      item = mbAwardItem(mb.id, mb.name, mb.eagle);
    } else {
      // Match against the MB's requirements; fall back to a synthetic if the
      // catalog tree is sparser than the ledger (some MBs don't have authored
      // sub-reqs).
      const req = mb.requirements.find((r) => r.code === reqCode);
      const label = req ? `${mb.name} req ${reqCode} — ${req.label}` : `${mb.name} req ${reqCode}`;
      item = mbReqItem(mb.id, mb.name, reqCode, label);
    }
    setScoutId(sid);
    setSelections([item]);
    // Strip the URL params so re-opens are clean. Use replace so this doesn't
    // pollute browser history.
    const url = new URL(window.location.href);
    url.searchParams.delete('scout');
    url.searchParams.delete('mb');
    url.searchParams.delete('req');
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the scout's existing ledger codes when scout changes so the picker
  // can render completed state with green checks + date badges.
  useEffect(() => {
    if (!scoutId) {
      setCompletion(new Map());
      setHistory({ service: [], events: [], leadership: [] });
      return;
    }
    let cancelled = false;
    setLoadingCompletion(true);
    // Fire both lookups in parallel — completion drives the picker overlay,
    // history drives the Service/Events/Leadership tab panels.
    loadScoutHistory(scoutId).then((h) => {
      if (!cancelled) setHistory(h);
    });
    loadScoutCompletion(scoutId).then((rows) => {
      if (cancelled) return;
      const map: CompletionMap = new Map();
      for (const r of rows) {
        map.set(r.key, {
          entryId: r.entryId,
          date: r.date,
          by: r.by,
          code: r.code
        });
      }
      setCompletion(map);
      setLoadingCompletion(false);
    });
    return () => {
      cancelled = true;
    };
  }, [scoutId]);

  function onCompletionRemoved(key: string) {
    setCompletion((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    router.refresh();
  }

  // Open the MB focus modal (Scout-First only). Requires a scout first so the
  // modal can show completion state + gate the award.
  function openMb(mbId: string) {
    if (!scoutId) {
      setStatus({ kind: 'err', msg: 'Pick a scout first.' });
      return;
    }
    setStatus(null);
    setOpenMbId(mbId);
  }

  // The modal saved a badge's requirements directly. Apply the same optimistic
  // overlay update + server reconciliation the inline Save uses. Closing is the
  // modal's call (so "Save & keep going" can leave it open).
  function onMbModalSaved(items: PickerItem[], savedDate: string, savedBy: string) {
    setCompletion((prev) => {
      const next = new Map(prev);
      for (const s of items) {
        next.set(s.key, { entryId: -1, date: savedDate, by: savedBy, code: s.code });
      }
      return next;
    });
    setStatus({
      kind: 'ok',
      msg: `Saved ${items.length} entr${items.length === 1 ? 'y' : 'ies'}.`
    });
    router.refresh();
    loadScoutCompletion(scoutId).then((rows) => {
      const map: CompletionMap = new Map();
      for (const r of rows) {
        map.set(r.key, { entryId: r.entryId, date: r.date, by: r.by, code: r.code });
      }
      setCompletion(map);
    });
  }

  function clear() {
    setSelections([]);
    setNotes('');
    setStatus(null);
  }

  function save() {
    if (!scoutId) {
      setStatus({ kind: 'err', msg: 'Pick a scout first.' });
      return;
    }
    if (selections.length === 0) {
      setStatus({ kind: 'err', msg: 'No requirements selected.' });
      return;
    }
    if (!date || !by) {
      setStatus({ kind: 'err', msg: 'Date and Signed-Off By are required.' });
      return;
    }
    // Block save if a pending award row's parent requirements aren't yet
    // satisfied (counting both completed entries and the current pending list).
    const awardErrors = validateAwards(selections, catalog, completion);
    if (awardErrors.length > 0) {
      const first = awardErrors[0];
      const more = awardErrors.length > 1 ? ` (+${awardErrors.length - 1} more)` : '';
      setStatus({
        kind: 'err',
        msg: `Can't award ${first.awardLabel} yet — req ${first.parentCode} "${first.parentLabel}" is at ${first.satisfied} of ${first.required}.${more}`
      });
      return;
    }
    const items = selections.map((s) => ({
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
    fd.set('notes', notes);
    fd.set('items', JSON.stringify(items));

    startTransition(async () => {
      const res = await addLedgerEntries(fd);
      if (!res.ok) {
        setStatus({ kind: 'err', msg: res.error ?? 'Save failed' });
        return;
      }
      // Optimistically move pending → completed in the local map.
      const now = new Date().toISOString().slice(0, 10);
      setCompletion((prev) => {
        const next = new Map(prev);
        for (const s of selections) {
          next.set(s.key, {
            entryId: -1, // unknown until refetch; refresh below replaces this
            date: now,
            by,
            code: s.code
          });
        }
        return next;
      });
      setStatus({ kind: 'ok', msg: `Saved ${res.inserted} entr${res.inserted === 1 ? 'y' : 'ies'}.` });
      setSelections([]);
      setNotes('');
      router.refresh();
      // Reload completion from server to pick up real entryIds.
      loadScoutCompletion(scoutId).then((rows) => {
        const map: CompletionMap = new Map();
        for (const r of rows) {
          map.set(r.key, {
            entryId: r.entryId,
            date: r.date,
            by: r.by,
            code: r.code
          });
        }
        setCompletion(map);
      });
    });
  }

  return (
    <div className={styles.card}>
      <h3>Scout-First Entry</h3>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Scout</span>
        <select
          className={styles.select}
          value={scoutId}
          onChange={(e) => {
            setScoutId(e.target.value);
            setSelections([]);
            setStatus(null);
          }}
        >
          <option value="">— Pick a scout —</option>
          {scouts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.display_name}
            </option>
          ))}
        </select>
      </label>

      <div className={`${styles.field} ${styles.reqFieldFill}`}>
        <span className={styles.fieldLabel}>
          Requirements{' '}
          {scoutId && loadingCompletion && (
            <span style={{ fontWeight: 400, color: 'var(--admin-gray-400)', textTransform: 'none', letterSpacing: 0 }}>
              · loading scout history…
            </span>
          )}
        </span>
        <RequirementPicker
          catalog={catalog}
          selections={selections}
          onSelectionsChange={setSelections}
          completion={completion}
          onCompletionRemoved={onCompletionRemoved}
          history={history}
          onHistoryRemoved={(entryId) => {
            // Drop from local history; the Server Action already revalidates,
            // so a soft refresh will refetch the full history.
            setHistory((prev) => ({
              service: prev.service.filter((r) => r.id !== entryId),
              events: prev.events.filter((r) => r.id !== entryId),
              leadership: prev.leadership.filter((r) => r.id !== entryId)
            }));
            router.refresh();
          }}
          onOpenMb={openMb}
          multi
        />
      </div>

      <MbFocusModal
        key={openMbId ?? 'closed'}
        mb={catalog.mbs.find((m) => m.id === openMbId) ?? null}
        scoutId={scoutId}
        scoutName={scouts.find((s) => s.id === scoutId)?.display_name ?? ''}
        leaders={leaders}
        defaultDate={date}
        defaultBy={by}
        completion={completion}
        onClose={() => setOpenMbId(null)}
        onCompletionRemoved={onCompletionRemoved}
        onSaved={onMbModalSaved}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Notes (optional)</span>
        <textarea
          className={styles.textarea}
          placeholder="Anything BoR or counselors should know"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      <div className={styles.actionsRow}>
        {status && (
          <span className={status.kind === 'ok' ? styles.statusOk : styles.statusErr}>
            {status.msg}
          </span>
        )}
        <button
          type="button"
          className={styles.btn}
          onClick={clear}
          disabled={isPending}
        >
          Clear
        </button>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={save}
          disabled={
            isPending ||
            selections.length === 0 ||
            !scoutId ||
            !date ||
            !by
          }
          title={
            !scoutId
              ? 'Pick a scout first'
              : !date
                ? 'Date is required'
                : !by
                  ? 'Signed-Off By is required'
                  : selections.length === 0
                    ? 'Select at least one requirement'
                    : undefined
          }
        >
          {isPending
            ? 'Saving…'
            : selections.length > 0
              ? `Save (${selections.length})`
              : 'Save'}
        </button>
      </div>
    </div>
  );
}
