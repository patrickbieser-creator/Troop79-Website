'use client';

/**
 * BSA Roster check + registrations on file. Check runs the report (no
 * writes); Save registration dates is the one write, a one-click action on
 * the roster just checked. Report sections are the decisions a leader has
 * to make; registrations on file is what the troop knows today.
 */
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { FormPanel } from '../../../_components/form-panel';
import { Button } from '../../../_components/button';
import { Notice } from '../../_components/notice';
import { Badge } from '../../_components/badge';
import { fmtDate } from '@/lib/format-date';
import { dueState, type DifferenceField, type RosterReport } from '@/lib/bsa-roster';
import type { StoredRegistration } from '@/lib/bsa-roster-db';
import type { RosterCheckResult, RosterSaveResult } from './actions';
import styles from './bsa-roster.module.css';

const FIELD_LABEL: Record<DifferenceField, string> = {
  bsa_member_id: 'BSA ID',
  ypt_completed: 'YPT completed',
  email: 'Email',
  phone: 'Phone',
  gender: 'Gender'
};

const personHref = (id: number) => `/admin/advancement/roster/${id}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function DueBadge({ expires, today }: { expires: string | null; today: string }) {
  const state = dueState(expires, today);
  if (state === 'expired') return <Badge variant="danger">Expired</Badge>;
  if (state === 'soon') return <Badge variant="warning">Due soon</Badge>;
  return null;
}

export function BsaRosterView({
  registrations,
  today,
  checkAction,
  saveAction
}: {
  registrations: StoredRegistration[];
  today: string;
  checkAction: (formData: FormData) => Promise<RosterCheckResult>;
  saveAction: (formData: FormData) => Promise<RosterSaveResult>;
}) {
  // The file that was checked: Save sends the same one. A plain submit handler, not a form action — React
  // resets a form after its action runs, which would clear the file the leader just chose.
  const [checkedFile, setCheckedFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RosterCheckResult | null>(null);
  const [saved, setSaved] = useState<RosterSaveResult | null>(null);
  const [hasFile, setHasFile] = useState(false);

  function check(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const file = formData.get('file');
    setCheckedFile(file instanceof File ? file : null);
    setSaved(null);
    startTransition(async () => setResult(await checkAction(formData)));
  }
  function save() {
    if (!checkedFile) return;
    const formData = new FormData();
    formData.append('file', checkedFile);
    startTransition(async () => setSaved(await saveAction(formData)));
  }

  return (
    <>
      <div className={styles.section}>
        <FormPanel title="Check a roster">
          <p className={styles.lede}>
            In my.scouting.org, open the unit&rsquo;s Roster Report and export it as CSV, then choose the file
            here. The file is read once and not kept.
          </p>
          <form onSubmit={check} className={styles.uploadRow}>
            <input
              className={styles.fileInput}
              type="file"
              name="file"
              accept=".csv,text/csv"
              aria-label="BSA Roster Report CSV"
              onChange={(e) => {
                setHasFile((e.target.files?.length ?? 0) > 0);
                setResult(null);
                setSaved(null);
              }}
            />
            <Button type="submit" variant="primary" disabled={isPending || !hasFile} title={hasFile ? undefined : 'Choose a CSV file first'}>
              {isPending && !result ? 'Checking…' : 'Check roster'}
            </Button>
          </form>
          {result && !result.ok && (
            <div className={styles.block}>
              <Notice variant="error">{result.error}</Notice>
            </div>
          )}
          {result && result.ok && (
            <RosterResult report={result.report} saved={saved} saving={isPending} onSave={save} />
          )}
        </FormPanel>
      </div>
      <div className={styles.section}>
        <RegistrationsOnFile registrations={registrations} today={today} />
      </div>
    </>
  );
}

function RosterResult({
  report,
  saved,
  saving,
  onSave
}: {
  report: RosterReport;
  saved: RosterSaveResult | null;
  saving: boolean;
  onSave: () => void;
}) {
  const members = report.matched.length + report.unmatched.length;
  return (
    <>
      <div className={styles.block}>
        <p className={styles.summaryLine}>
          {plural(members, 'member')} on the roster{report.asOf ? ` of ${fmtDate(report.asOf)}` : ''},{' '}
          {report.matched.length} matched to our people.
        </p>
        <div className={styles.saveRow}>
          <Button variant="primary" onClick={onSave} disabled={saving || saved?.ok === true || report.registrations.length === 0}>
            {saved?.ok ? 'Saved' : saving ? 'Saving…' : `Save registration dates (${report.registrations.length})`}
          </Button>
          {saved && saved.ok && <span className={styles.savedNote}>Saved for {plural(saved.saved, 'person', 'people')}.</span>}
        </div>
        {saved && !saved.ok && <Notice variant="error">{saved.error}</Notice>}
      </div>

      <Section title="Differences" sub="BSA has something we don't. Fix it on the person's record if BSA is right." count={report.differences.length}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Person</th>
              <th>What</th>
              <th>BSA roster</th>
              <th>Ours</th>
            </tr>
          </thead>
          <tbody>
            {report.differences.map((d) => (
              <tr key={`${d.personId}-${d.field}`}>
                <td>
                  <Link href={personHref(d.personId)}>{d.name}</Link>
                </td>
                <td>{FIELD_LABEL[d.field]}</td>
                <td>{d.field === 'ypt_completed' ? fmtDate(d.roster) : d.roster}</td>
                <td>{d.ours == null ? '—' : d.field === 'ypt_completed' ? fmtDate(d.ours) : d.ours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="On the roster, not found here" sub="No person with this BSA ID or name." count={report.unmatched.length}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>BSA ID</th>
              <th>Position</th>
            </tr>
          </thead>
          <tbody>
            {report.unmatched.map((m) => (
              <tr key={m.memberId}>
                <td>
                  {m.firstName} {m.lastName}
                </td>
                <td>{m.memberId}</td>
                <td>{m.positions.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Inactive here, still registered" sub="Their BSA registration runs until it expires." count={report.inactiveButRegistered.length}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Person</th>
              <th>Why inactive</th>
              <th>Registered until</th>
            </tr>
          </thead>
          <tbody>
            {report.inactiveButRegistered.map((r) => (
              <tr key={r.personId}>
                <td>
                  <Link href={personHref(r.personId)}>{r.name}</Link>
                </td>
                <td>{r.reason ? r.reason.replace(/_/g, ' ') : '—'}</td>
                <td>
                  {r.expires ? fmtDate(r.expires) : '—'}
                  {r.autoRenewOptedOut ? ' · auto-renew off' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Active here, not on the roster" sub="Scouts not registered yet, and adults with a troop role." count={report.notOnRoster.length}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Person</th>
              <th>Kind</th>
              <th>Role here</th>
            </tr>
          </thead>
          <tbody>
            {report.notOnRoster.map((r) => (
              <tr key={r.personId}>
                <td>
                  <Link href={personHref(r.personId)}>{r.name}</Link>
                </td>
                <td>{r.kind === 'scout' ? 'Scout' : 'Adult'}</td>
                <td>{r.detail ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

function Section({ title, sub, count, children }: { title: string; sub: string; count: number; children: ReactNode }) {
  return (
    <div className={styles.block}>
      <h3>
        {title} ({count})
      </h3>
      {count === 0 ? <p className={styles.blockSub}>None.</p> : (
        <>
          <p className={styles.blockSub}>{sub}</p>
          {children}
        </>
      )}
    </div>
  );
}

function RegistrationsOnFile({ registrations, today }: { registrations: StoredRegistration[]; today: string }) {
  const asOf = registrations.map((r) => r.asOf).filter(Boolean).sort().at(-1);
  return (
    <FormPanel title="Registrations on file" note={asOf ? `From the roster of ${fmtDate(asOf)}. Soonest first.` : undefined}>
      {registrations.length === 0 ? (
        <p className={styles.blockSub}>None yet. Check a roster above and save its registration dates.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Person</th>
              <th>Positions</th>
              <th>Expires</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {registrations.map((r) => (
              <tr key={r.personId}>
                <td>
                  <Link href={personHref(r.personId)}>{r.name}</Link>
                </td>
                <td>{r.positions.join(', ')}</td>
                <td>
                  {r.expires ? fmtDate(r.expires) : '—'} <DueBadge expires={r.expires} today={today} />
                </td>
                <td>
                  {r.status ?? '—'}
                  {r.autoRenewOptedOut ? ' · auto-renew off' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </FormPanel>
  );
}
