'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import { ScoutAccordion, type RemoveTarget } from '@/app/_components/ScoutAccordion';
import { DatePickerField } from '../../_components/date-picker-field';
import { buildScoutView, toMarkdown } from '@/lib/advancement-report';
import {
  generateReportAction,
  regenerateReportAction,
  removeScoutAction,
  saveNoteAction,
  publishReportAction,
  type AdvancementReportRow
} from './actions';
import styles from './report.module.css';

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReportWorkspace({
  initialReport,
  recentReports,
  lastPublishedEnd
}: {
  initialReport: AdvancementReportRow | null;
  recentReports: AdvancementReportRow[];
  lastPublishedEnd: string | null;
}) {
  const router = useRouter();
  const [report, setReport] = useState<AdvancementReportRow | null>(initialReport);
  const [startDate, setStartDate] = useState(
    initialReport?.startDate ?? (lastPublishedEnd ? addOneDay(lastPublishedEnd) : '')
  );
  const [endDate, setEndDate] = useState(initialReport?.endDate ?? (lastPublishedEnd ? todayIso() : ''));
  const [view, setView] = useState<'category' | 'markdown' | 'scout'>('category');
  const [note, setNote] = useState(initialReport?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const scoutView = useMemo(() => (report ? buildScoutView(report.contentJson) : []), [report]);
  const range = useMemo(
    () => (report ? { startDate: report.startDate, endDate: report.endDate } : null),
    [report]
  );
  // Body only — the page already renders its own title/dateline/note; the
  // stored content_md's preamble is for the standalone Bugle export only
  // (found live-testing the real page before shipping: without this, the
  // date range and note showed twice).
  const bodyMd = useMemo(
    () => (report && range ? toMarkdown(report.contentJson, range, null, { includeHeader: false }) : ''),
    [report, range]
  );

  function act(fn: () => Promise<{ ok: boolean; error?: string; report?: AdvancementReportRow }>, okMessage: string) {
    setError(null);
    setSaved(null);
    setBusy(true);
    fn()
      .then((res) => {
        if (!res.ok) {
          setError(res.error ?? 'Something went wrong.');
          return;
        }
        if (res.report) setReport(res.report);
        setSaved(okMessage);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
      .finally(() => setBusy(false));
  }

  function generate() {
    if (report) {
      act(() => regenerateReportAction(report.id, startDate, endDate), 'Report regenerated.');
    } else {
      act(async () => {
        const res = await generateReportAction(startDate, endDate);
        if (res.ok && res.report) router.push(`/admin/advancement/report?id=${res.report.id}`);
        return res;
      }, 'Report generated.');
    }
  }

  function handleRemove(target: RemoveTarget) {
    if (!report) return;
    act(() => removeScoutAction(report.id, target), 'Removed.');
  }

  function saveNote() {
    if (!report) return;
    act(() => saveNoteAction(report.id, note), 'Note saved.');
  }

  function publish() {
    if (!report) return;
    act(() => publishReportAction(report.id), 'Published.');
  }

  function copyMarkdown() {
    if (!report) return;
    navigator.clipboard.writeText(report.contentMd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const disabled = busy;
  const canGenerate = startDate !== '' && endDate !== '' && startDate <= endDate;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Date range</h2>
          <p className={styles.hint}>
            Filters on when it was entered, not when it was earned — a backfilled correction
            entered today lands in today&rsquo;s report even if it was earned months ago.
          </p>
          <div className={styles.dateRow}>
            <label className={styles.dateField}>
              <span className={styles.dateLabel}>Start</span>
              <DatePickerField value={startDate} onChange={setStartDate} disabled={disabled} />
            </label>
            <label className={styles.dateField}>
              <span className={styles.dateLabel}>End</span>
              <DatePickerField value={endDate} onChange={setEndDate} disabled={disabled} />
            </label>
            <button type="button" className={styles.primaryBtn} onClick={generate} disabled={disabled || !canGenerate}>
              {busy ? 'Working…' : report ? 'Regenerate' : 'Generate'}
            </button>
          </div>
          {report?.status === 'published' && (
            <p className={styles.publishedNote}>
              Published {new Date(report.publishedAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {report.publishedBy ? ` by ${report.publishedBy}` : ''}
              {report.correctedAt && (
                <> · corrected {new Date(report.correctedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{report.correctedBy ? ` by ${report.correctedBy}` : ''}</>
              )}
              . Editing here corrects it in place — the published date stays as it was.
            </p>
          )}
        </section>

        {error && <div className={styles.errorBox}>{error}</div>}
        {saved && <div className={styles.savedBox}>{saved}</div>}

        {report && range && (
          <>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Editor&rsquo;s note</h2>
              <textarea
                className={styles.noteInput}
                rows={2}
                value={note}
                disabled={disabled}
                placeholder="Optional — e.g. “Light week, most of the troop was traveling.”"
                onChange={(e) => setNote(e.target.value)}
              />
              <button type="button" className={styles.smallBtn} onClick={saveNote} disabled={disabled}>
                Save note
              </button>
            </section>

            <section className={styles.card}>
              <div className={styles.viewTabs}>
                <button
                  type="button"
                  className={view === 'category' ? styles.viewTabActive : styles.viewTab}
                  onClick={() => setView('category')}
                >
                  By Category
                </button>
                <button
                  type="button"
                  className={view === 'scout' ? styles.viewTabActive : styles.viewTab}
                  onClick={() => setView('scout')}
                >
                  By Scout
                </button>
                <button
                  type="button"
                  className={view === 'markdown' ? styles.viewTabActive : styles.viewTab}
                  onClick={() => setView('markdown')}
                >
                  Markdown (for the Bugle)
                </button>
              </div>

              {view === 'category' && <ArticleBody body={bodyMd} />}
              {view === 'scout' && (
                <ScoutAccordion scoutView={scoutView} range={range} editable onRemove={handleRemove} />
              )}
              {view === 'markdown' && (
                <div className={styles.markdownPane}>
                  <button type="button" className={styles.smallBtn} onClick={copyMarkdown}>
                    {copied ? 'Copied ✓' : 'Copy markdown'}
                  </button>
                  <pre className={styles.markdownPre}>{report.contentMd}</pre>
                </div>
              )}
            </section>

            {report.status === 'draft' && (
              <section className={styles.card}>
                {/* Actions ▾ (2026-08-20, D-156 shape) — Publish is the one
                    field-free, discrete step here; Generate/Regenerate and
                    Save note stay inline above since each sits directly next
                    to the field it acts on (ux-lead, 2026-08-20). */}
                <select
                  value=""
                  className={styles.select}
                  aria-label="Report actions"
                  disabled={disabled}
                  onChange={(e) => {
                    const v = e.target.value;
                    e.target.value = '';
                    if (v === 'publish') publish();
                  }}
                >
                  <option value="">Actions…</option>
                  {!report.contentJson.isEmpty && <option value="publish">Publish</option>}
                </select>
                {report.contentJson.isEmpty && (
                  <p className={styles.hint} style={{ marginTop: 8 }}>
                    Nothing was logged in this date range — publishing is disabled. Widen the range,
                    or this may just be a quiet week not worth publishing at all.
                  </p>
                )}
              </section>
            )}
          </>
        )}

        {!report && (
          <p className={styles.hint}>Pick a date range and Generate to build the report.</p>
        )}
      </div>

      <aside className={styles.sidebar}>
        <h2 className={styles.sidebarTitle}>Recent reports</h2>
        {recentReports.length === 0 ? (
          <p className={styles.hint}>None yet.</p>
        ) : (
          <ul className={styles.reportList}>
            {recentReports.map((r) => (
              <li key={r.id}>
                <a
                  href={`/admin/advancement/report?id=${r.id}`}
                  className={r.id === report?.id ? styles.reportLinkActive : styles.reportLink}
                >
                  <span>
                    {r.startDate} – {r.endDate}
                  </span>
                  <span className={r.status === 'published' ? styles.badgePublished : styles.badgeDraft}>
                    {r.status === 'published' ? 'Published' : 'Draft'}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
