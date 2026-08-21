'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import { ScoutAccordion, type RemoveTarget } from '@/app/_components/ScoutAccordion';
import { DatePickerField } from '../../_components/date-picker-field';
import { buildScoutView, toMarkdown } from '@/lib/advancement-report';
import {
  generateCourtOfHonorAction,
  regenerateCourtOfHonorAction,
  removeScoutFromCohAction,
  saveCohNoteAction,
  publishCourtOfHonorAction,
  markCourtOfHonorPresentedAction,
  type CourtOfHonorRow
} from './actions';
import styles from './court-of-honor.module.css';
import { Badge } from '../../_components/badge';
import { TabStrip } from '../../_components/tab-strip';
import { ActionsMenu } from '../../_components/actions-menu';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CourtOfHonorWorkspace({
  initialReport,
  recentReports,
  lastPublishedEnd
}: {
  initialReport: CourtOfHonorRow | null;
  recentReports: CourtOfHonorRow[];
  lastPublishedEnd: string | null;
}) {
  const router = useRouter();
  const [report, setReport] = useState<CourtOfHonorRow | null>(initialReport);
  const [startDate, setStartDate] = useState(
    initialReport?.startDate ?? (lastPublishedEnd ? addOneDay(lastPublishedEnd) : '')
  );
  const [endDate, setEndDate] = useState(initialReport?.endDate ?? todayIso());
  const [view, setView] = useState<'category' | 'markdown' | 'scout'>('category');
  const [note, setNote] = useState(initialReport?.note ?? '');
  const [presentationDate, setPresentationDate] = useState(initialReport?.endDate ?? todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const scoutView = useMemo(() => (report ? buildScoutView(report.contentJson) : []), [report]);
  const range = useMemo(
    () => (report ? { startDate: report.startDate, endDate: report.endDate } : null),
    [report]
  );
  // Body only — the page already renders its own title; see the Weekly
  // Report's report-workspace.tsx for the identical reasoning.
  const bodyMd = useMemo(
    () => (report && range ? toMarkdown(report.contentJson, range, null, { includeHeader: false }) : ''),
    [report, range]
  );

  // Re-seed the presentation-date default whenever a DIFFERENT report loads
  // (useState's initializer only runs once, and a report generated during
  // this session — as opposed to one present on first page load — needs
  // this too). Still just a default; always editable before confirming.
  useEffect(() => {
    // Resetting a default when a DIFFERENT report loads, not synchronizing
    // every render.
    if (report) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPresentationDate(report.endDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id]);

  function act(fn: () => Promise<{ ok: boolean; error?: string; report?: CourtOfHonorRow }>, okMessage: string) {
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
      act(() => regenerateCourtOfHonorAction(report.id, startDate, endDate), 'Report regenerated.');
    } else {
      act(async () => {
        const res = await generateCourtOfHonorAction(startDate, endDate);
        if (res.ok && res.report) router.push(`/admin/advancement/court-of-honor?id=${res.report.id}`);
        return res;
      }, 'Report generated.');
    }
  }

  function handleRemove(target: RemoveTarget) {
    if (!report) return;
    act(() => removeScoutFromCohAction(report.id, target), 'Removed.');
  }

  function saveNote() {
    if (!report) return;
    act(() => saveCohNoteAction(report.id, note), 'Note saved.');
  }

  function publish() {
    if (!report) return;
    act(() => publishCourtOfHonorAction(report.id), 'Published.');
  }

  function markPresented() {
    if (!report) return;
    act(() => markCourtOfHonorPresentedAction(report.id, presentationDate), 'Marked as presented.');
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
            Filters on when it was EARNED, not when it was entered — the opposite rule from the
            Weekly Report. A ceremony recognizes what actually happened in this period.
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
                placeholder="Optional — e.g. “Held at Brookfield East.”"
                onChange={(e) => setNote(e.target.value)}
              />
              <button type="button" className={styles.smallBtn} onClick={saveNote} disabled={disabled}>
                Save note
              </button>
            </section>

            <section className={styles.card}>
              {/* Shared pill TabStrip — Patrick's Phase B call (2026-08-21):
                  fold the boxed view-tab one-off into the one tab pattern. */}
              <div className={styles.viewTabsRow}>
                <TabStrip
                  ariaLabel="Report view"
                  activeKey={view}
                  items={[
                    { key: 'category', label: 'By Type', onSelect: () => setView('category') },
                    { key: 'scout', label: 'By Scout', onSelect: () => setView('scout') },
                    { key: 'markdown', label: 'Markdown', onSelect: () => setView('markdown') }
                  ]}
                />
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

            <section className={styles.card}>
              {/* Actions ▾ (2026-08-20, D-156 shape) — Download CSV and
                  Publish are both field-free, discrete steps; Generate/
                  Regenerate, Save note, and Mark Presented stay inline
                  above/below since each sits next to a field or a warning
                  it depends on (ux-lead, 2026-08-20). */}
              <ActionsMenu
                ariaLabel="Court of Honor actions"
                disabled={disabled}
                options={[
                  { value: 'download', label: 'Download CSV' },
                  ...(report.status === 'draft' && !report.contentJson.isEmpty
                    ? [{ value: 'publish', label: 'Publish' }]
                    : [])
                ]}
                onAction={(v) => {
                  if (v === 'download')
                    router.push(`/admin/advancement/court-of-honor/export?id=${report.id}`);
                  else if (v === 'publish') publish();
                }}
              />
              {report.contentJson.isEmpty && report.status === 'draft' && (
                <p className={styles.hint} style={{ marginTop: 8 }}>
                  Nothing was earned in this date range — publishing is disabled. Widen the range.
                </p>
              )}
              {report.status === 'draft' && (
                <p className={styles.hint} style={{ marginTop: 8 }}>
                  Publishing finalizes this report&rsquo;s content — it does NOT mark anything as presented.
                  That&rsquo;s a separate step below, once published.
                </p>
              )}
            </section>

            {report.status === 'published' && (
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>Confirm the ceremony happened</h2>
                <p className={styles.hint}>
                  Publishing above just locks in the content for printing and prep — it does{' '}
                  <strong>not</strong> mark anything as presented. Only click this once the ceremony has
                  actually happened, since Court of Honors are outdoors and do get rained out. If it&rsquo;s
                  rescheduled, just enter the real date when you do click it.
                </p>
                <div className={styles.dateRow}>
                  <label className={styles.dateField}>
                    <span className={styles.dateLabel}>Date presented</span>
                    <DatePickerField value={presentationDate} onChange={setPresentationDate} disabled={disabled} />
                  </label>
                  <button
                    type="button"
                    className={styles.publishBtn}
                    onClick={markPresented}
                    disabled={disabled || !presentationDate}
                  >
                    Mark items as Presented
                  </button>
                </div>
                {report.presentedAt && (
                  <p className={styles.publishedNote}>
                    Confirmed presented{' '}
                    {new Date(report.presentedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {report.presentedBy ? ` by ${report.presentedBy}` : ''}. Safe to run again — e.g. after
                    adding a scout back in — it only fills in items not already marked.
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
        <h2 className={styles.sidebarTitle}>Recent ceremonies</h2>
        {recentReports.length === 0 ? (
          <p className={styles.hint}>None yet.</p>
        ) : (
          <ul className={styles.reportList}>
            {recentReports.map((r) => (
              <li key={r.id}>
                <a
                  href={`/admin/advancement/court-of-honor?id=${r.id}`}
                  className={r.id === report?.id ? styles.reportLinkActive : styles.reportLink}
                >
                  <span>
                    {r.startDate} – {r.endDate}
                  </span>
                  <Badge variant={r.status === 'published' ? 'success' : 'warning'}>
                    {r.status === 'published' ? 'Published' : 'Draft'}
                  </Badge>
                </a>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
