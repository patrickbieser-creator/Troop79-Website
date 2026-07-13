'use client';

/**
 * CSV import for the calendar — reads the Bugle Google Sheet's sheet2ics
 * export (start_date, end_date, start_time, end_time, title, description,
 * location, categories, component, uid) and reconciles it against the
 * current calendar_entries:
 *
 *   * NEW rows (no entry with the same date + title) import as inserts —
 *     each can instead be pointed at an existing same-date entry when the
 *     sheet retitled something.
 *   * CHANGED rows (date + title matched, other fields differ) show a
 *     per-field old → new diff with an Apply / Keep choice per row.
 *   * UNCHANGED rows are counted and skipped.
 *   * DB entries inside the CSV's date range that the CSV no longer carries
 *     are listed for information only (possible cancellations) — the import
 *     never deletes.
 *
 * day_note and article_id aren't in the sheet, so updates never touch them.
 */

import { useMemo, useRef, useState, useTransition } from 'react';
import type { CalendarCategory, CalendarEntry } from '@/lib/supabase/types';
import type { ImportResult, ImportRowFields, ImportUpdate } from './actions';
import styles from './calendar.module.css';

interface Props {
  rows: CalendarEntry[];
  categories: CalendarCategory[];
  onImport: (inserts: ImportRowFields[], updates: ImportUpdate[]) => Promise<ImportResult>;
}

// ── CSV plumbing ──────────────────────────────────────────────────────────

/** Minimal CSV parser: quoted fields, embedded commas/newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** '5/2/26', '5/2/2026', '2026-05-02' → '2026-05-02' (or null). */
function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

/** '10:30:00 AM', '1:00 PM', '13:00' → 'HH:MM' 24h (or null). */
function toHm(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[3]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

const norm = (v: string | null | undefined) => (v ?? '').trim();
const normTime = (v: string | null | undefined) => (v ?? '').slice(0, 5);
const matchKey = (date: string, title: string) => `${date}|${norm(title).toLowerCase()}`;

// ── Reconciliation plan ───────────────────────────────────────────────────

interface CsvRow {
  fields: ImportRowFields;
  categoryValid: boolean;
  rawCategory: string;
}

interface NewItem extends CsvRow {
  idx: number;
  sameDate: CalendarEntry[];
}

interface Diff {
  label: string;
  oldVal: string;
  newVal: string;
}

interface ChangeItem {
  entry: CalendarEntry;
  fields: ImportRowFields;
  diffs: Diff[];
}

interface Plan {
  news: NewItem[];
  changes: ChangeItem[];
  unchanged: number;
  orphans: CalendarEntry[];
  errors: string[];
}

const DIFF_FIELDS: { key: keyof ImportRowFields; label: string; time?: boolean }[] = [
  { key: 'end_date', label: 'End date' },
  { key: 'start_time', label: 'Start time', time: true },
  { key: 'end_time', label: 'End time', time: true },
  { key: 'category', label: 'Category' },
  { key: 'description', label: 'Description' },
  { key: 'location', label: 'Location' }
];

function buildPlan(text: string, existing: CalendarEntry[], categories: CalendarCategory[]): Plan {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length < 2) return { news: [], changes: [], unchanged: 0, orphans: [], errors: ['CSV is empty.'] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const cStart = col('start_date');
  const cTitle = col('title');
  if (cStart < 0 || cTitle < 0) {
    return {
      news: [],
      changes: [],
      unchanged: 0,
      orphans: [],
      errors: ['Header must include start_date and title (sheet2ics export format).']
    };
  }
  const cEnd = col('end_date');
  const cSt = col('start_time');
  const cEt = col('end_time');
  const cDesc = col('description');
  const cLoc = col('location');
  const cCat = col('categories') >= 0 ? col('categories') : col('category');

  // Space/punctuation-insensitive: the sheet says "Fund Raiser", the DB says
  // "Fundraiser" — same category.
  const catKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const catByNorm = new Map(categories.map((c) => [catKey(c), c]));

  const parsed: CsvRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const entryDate = toIsoDate(r[cStart] ?? '');
    const title = norm(r[cTitle]);
    if (!entryDate || !title) {
      errors.push(`Row ${i + 1}: ${!entryDate ? `bad date "${r[cStart]}"` : 'missing title'} — skipped.`);
      continue;
    }
    const key = matchKey(entryDate, title);
    if (seen.has(key)) {
      errors.push(`Row ${i + 1}: duplicate of ${entryDate} "${title}" — skipped.`);
      continue;
    }
    seen.add(key);

    const endIso = cEnd >= 0 ? toIsoDate(r[cEnd] ?? '') : null;
    const rawCategory = cCat >= 0 ? norm(r[cCat]) : '';
    const category = catByNorm.get(catKey(rawCategory)) ?? '';
    parsed.push({
      fields: {
        entry_date: entryDate,
        end_date: endIso && endIso !== entryDate ? endIso : null,
        start_time: cSt >= 0 ? toHm(r[cSt] ?? '') : null,
        end_time: cEt >= 0 ? toHm(r[cEt] ?? '') : null,
        category,
        title,
        description: cDesc >= 0 ? norm(r[cDesc]) || null : null,
        location: cLoc >= 0 ? norm(r[cLoc]) || null : null
      },
      categoryValid: category !== '',
      rawCategory
    });
  }

  const existingByKey = new Map<string, CalendarEntry>();
  for (const e of existing) {
    const k = matchKey(e.entry_date, e.title);
    if (!existingByKey.has(k)) existingByKey.set(k, e);
  }

  const news: NewItem[] = [];
  const changes: ChangeItem[] = [];
  let unchanged = 0;
  const matchedIds = new Set<number>();

  for (const row of parsed) {
    const match = existingByKey.get(matchKey(row.fields.entry_date, row.fields.title));
    if (!match) {
      news.push({
        ...row,
        idx: news.length,
        sameDate: existing.filter((e) => e.entry_date === row.fields.entry_date)
      });
      continue;
    }
    matchedIds.add(match.id);
    // An unrecognized sheet category never overwrites a matched entry's
    // category — treat it as unchanged instead.
    const fields = { ...row.fields };
    if (!row.categoryValid) fields.category = match.category;

    const diffs: Diff[] = [];
    for (const f of DIFF_FIELDS) {
      const oldRaw = match[f.key as keyof CalendarEntry] as string | null;
      const oldVal = f.time ? normTime(oldRaw) : norm(oldRaw);
      const newVal = f.time ? normTime(fields[f.key]) : norm(fields[f.key]);
      if (oldVal !== newVal) diffs.push({ label: f.label, oldVal: oldVal || '—', newVal: newVal || '—' });
    }
    if (diffs.length === 0) unchanged++;
    else changes.push({ entry: match, fields, diffs });
  }

  const csvDates = parsed.map((p) => p.fields.entry_date).sort();
  const orphans =
    csvDates.length === 0
      ? []
      : existing.filter(
          (e) =>
            e.entry_date >= csvDates[0] &&
            e.entry_date <= csvDates[csvDates.length - 1] &&
            !matchedIds.has(e.id)
        );

  return { news, changes, unchanged, orphans, errors };
}

// ── Component ─────────────────────────────────────────────────────────────

export function CalendarImport({ rows, categories, onImport }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [fileName, setFileName] = useState('');
  const [checkedNew, setCheckedNew] = useState<Set<number>>(new Set());
  const [matchTo, setMatchTo] = useState<Record<number, string>>({});
  const [catPick, setCatPick] = useState<Record<number, string>>({});
  const [changeSkip, setChangeSkip] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function openFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const p = buildPlan(String(reader.result ?? ''), rows, categories);
      setPlan(p);
      setFileName(file.name);
      setCheckedNew(new Set(p.news.filter((n) => n.categoryValid).map((n) => n.idx)));
      setMatchTo({});
      setCatPick({});
      setChangeSkip(new Set());
      setErr(null);
      setDone(null);
    };
    reader.readAsText(file);
  }

  const pendingCounts = useMemo(() => {
    if (!plan) return { inserts: 0, updates: 0 };
    let inserts = 0;
    let updates = plan.changes.filter((c) => !changeSkip.has(c.entry.id)).length;
    for (const n of plan.news) {
      if (!checkedNew.has(n.idx)) continue;
      if (matchTo[n.idx]) updates++;
      else inserts++;
    }
    return { inserts, updates };
  }, [plan, checkedNew, matchTo, changeSkip]);

  function apply() {
    if (!plan) return;
    setErr(null);
    const inserts: ImportRowFields[] = [];
    const updates: ImportUpdate[] = [];
    for (const n of plan.news) {
      if (!checkedNew.has(n.idx)) continue;
      const category = n.categoryValid ? n.fields.category : catPick[n.idx] ?? '';
      if (!category) continue;
      const fields = { ...n.fields, category };
      if (matchTo[n.idx]) updates.push({ id: Number(matchTo[n.idx]), fields });
      else inserts.push(fields);
    }
    for (const c of plan.changes) {
      if (changeSkip.has(c.entry.id)) continue;
      updates.push({ id: c.entry.id, fields: c.fields });
    }
    startTransition(async () => {
      const res = await onImport(inserts, updates);
      if (!res.ok) {
        setErr(res.error ?? 'Import failed.');
        return;
      }
      setDone(res);
    });
  }

  const needsCategory = plan
    ? plan.news.filter((n) => checkedNew.has(n.idx) && !n.categoryValid && !catPick[n.idx]).length
    : 0;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = '';
        }}
      />
      <button type="button" className={styles.editBtn} onClick={() => fileRef.current?.click()}>
        Import CSV
      </button>

      {plan && (
        <div className={styles.importOverlay} role="dialog" aria-modal="true" aria-label="CSV import review">
          <div className={styles.importPanel}>
            <div className={styles.dialogHeader}>
              <h3>Import review — {fileName}</h3>
              <p>
                {plan.news.length} new &middot; {plan.changes.length} changed &middot; {plan.unchanged}{' '}
                unchanged{plan.orphans.length > 0 && <> &middot; {plan.orphans.length} only in calendar</>}.
                Nothing is written until you apply.
              </p>
            </div>

            {done ? (
              <div className={styles.importBody}>
                <p className={styles.okNote}>
                  Imported: {done.inserted} added, {done.updated} updated.
                </p>
              </div>
            ) : (
              <div className={styles.importBody}>
                {plan.errors.length > 0 && (
                  <div className={styles.editError}>
                    {plan.errors.map((e, i) => (
                      <div key={i}>{e}</div>
                    ))}
                  </div>
                )}

                {plan.news.length > 0 && (
                  <>
                    <h4 className={styles.importSection}>
                      New entries
                      <span>
                        <button
                          type="button"
                          className={styles.editBtn}
                          onClick={() => setCheckedNew(new Set(plan.news.map((n) => n.idx)))}
                        >
                          All
                        </button>
                        <button type="button" className={styles.editBtn} onClick={() => setCheckedNew(new Set())}>
                          None
                        </button>
                      </span>
                    </h4>
                    {plan.news.map((n) => (
                      <div key={n.idx} className={styles.importCard}>
                        <label className={styles.importCheck}>
                          <input
                            type="checkbox"
                            checked={checkedNew.has(n.idx)}
                            onChange={() =>
                              setCheckedNew((prev) => {
                                const next = new Set(prev);
                                if (next.has(n.idx)) next.delete(n.idx);
                                else next.add(n.idx);
                                return next;
                              })
                            }
                          />
                          <span>
                            <strong>{n.fields.entry_date}</strong>
                            {n.fields.end_date && <> &rarr; {n.fields.end_date}</>} &middot; {n.fields.title}
                            {(n.fields.start_time || n.fields.location) && (
                              <span className={styles.muted}>
                                {' '}
                                ({[n.fields.start_time, n.fields.location].filter(Boolean).join(' · ')})
                              </span>
                            )}
                          </span>
                        </label>
                        <div className={styles.importCardCtl}>
                          {n.categoryValid ? (
                            <span className={styles.catTag}>{n.fields.category}</span>
                          ) : (
                            <select
                              className={styles.editInput}
                              value={catPick[n.idx] ?? ''}
                              onChange={(e) => setCatPick((p) => ({ ...p, [n.idx]: e.target.value }))}
                            >
                              <option value="">
                                {n.rawCategory ? `Category? (sheet says "${n.rawCategory}")` : 'Pick a category…'}
                              </option>
                              {categories.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          )}
                          {n.sameDate.length > 0 && (
                            <select
                              className={styles.editInput}
                              value={matchTo[n.idx] ?? ''}
                              onChange={(e) => setMatchTo((p) => ({ ...p, [n.idx]: e.target.value }))}
                              title="If this is really an existing entry that was retitled in the sheet, update it instead of adding a duplicate."
                            >
                              <option value="">Import as new</option>
                              {n.sameDate.map((e) => (
                                <option key={e.id} value={e.id}>
                                  Update: {e.title}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {plan.changes.length > 0 && (
                  <>
                    <h4 className={styles.importSection}>Changed entries</h4>
                    {plan.changes.map((c) => (
                      <div key={c.entry.id} className={styles.importCard}>
                        <div className={styles.importDiffHead}>
                          <span>
                            <strong>{c.entry.entry_date}</strong> &middot; {c.entry.title}
                          </span>
                          <label className={styles.importCheck}>
                            <input
                              type="checkbox"
                              checked={!changeSkip.has(c.entry.id)}
                              onChange={() =>
                                setChangeSkip((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(c.entry.id)) next.delete(c.entry.id);
                                  else next.add(c.entry.id);
                                  return next;
                                })
                              }
                            />
                            <span>Apply</span>
                          </label>
                        </div>
                        <table className={styles.importDiffTable}>
                          <tbody>
                            {c.diffs.map((d) => (
                              <tr key={d.label}>
                                <td>{d.label}</td>
                                <td className={styles.importOld}>{d.oldVal}</td>
                                <td aria-hidden="true">&rarr;</td>
                                <td className={styles.importNew}>{d.newVal}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </>
                )}

                {plan.orphans.length > 0 && (
                  <>
                    <h4 className={styles.importSection}>In the calendar but not in this CSV</h4>
                    <p className={styles.muted} style={{ fontStyle: 'normal', marginBottom: 8 }}>
                      Within the CSV&rsquo;s date range but absent from it — possibly cancelled in the
                      sheet. The import never deletes; remove manually if they&rsquo;re gone for real.
                    </p>
                    <ul className={styles.importOrphans}>
                      {plan.orphans.map((e) => (
                        <li key={e.id}>
                          {e.entry_date} &middot; {e.title} <span className={styles.muted}>({e.category})</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {err && <div className={styles.editError}>{err}</div>}
            {needsCategory > 0 && !done && (
              <p className={styles.muted} style={{ fontStyle: 'normal', marginTop: 6 }}>
                {needsCategory} checked row{needsCategory === 1 ? ' still needs' : 's still need'} a
                category before they can import.
              </p>
            )}

            <div className={styles.dialogActions}>
              <button type="button" className={styles.editBtn} onClick={() => setPlan(null)} disabled={isPending}>
                {done ? 'Close' : 'Cancel'}
              </button>
              {!done && (
                <button
                  type="button"
                  className={styles.editSaveBtn}
                  onClick={apply}
                  disabled={isPending || (pendingCounts.inserts === 0 && pendingCounts.updates === 0)}
                >
                  {isPending
                    ? 'Importing…'
                    : `Apply (${pendingCounts.inserts} new, ${pendingCounts.updates} updates)`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
