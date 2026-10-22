'use client';

/**
 * By Scout and Teaching Roster (Build a Plan B4, Decision 3). Admin's generator (Generate Plan / Group Sessions) and
 * Publish to Site retired: Build a Plan (/planner/build) is the plan of record and its Suggested column is the
 * generator. These two views only ever lived inside the generator, so they stay here on their own: pick a date and
 * the ledger engine (lib/meeting-suggest) says what each scout could work on next and who is set up to teach.
 * Read-only; nothing is stored.
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { MeetingPlanPayload } from '@/lib/meeting-plan-types';
import { generatePlan } from '../actions';
import { DatePickerField } from '../../../_components/date-picker-field';
import styles from '../meeting-plan.module.css';
import { TabStrip } from '../../../_components/tab-strip';
import { Button } from '../../../../_components/button';

interface Props {
  /** Next Sunday — the troop's meeting day. */
  defaultDate: string;
}

type PlanTab = 'scouts' | 'roster';

export function PlanView({ defaultDate }: Props) {
  const [meetingDate, setMeetingDate] = useState(defaultDate);
  const [payload, setPayload] = useState<MeetingPlanPayload | null>(null);
  const [tab, setTab] = useState<PlanTab>('scouts');
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function show() {
    if (!meetingDate) return;
    setStatus(null);
    const fd = new FormData();
    fd.set('meetingDate', meetingDate);
    fd.set('title', 'Troop Meeting');
    startTransition(async () => {
      const res = await generatePlan(fd);
      if (!res.ok || !res.payload) {
        setStatus(res.error ?? 'That didn’t load. Try again.');
        return;
      }
      setPayload(res.payload);
    });
  }

  return (
    <>
      <div className={styles.tabsRow}>
        <TabStrip
          ariaLabel="View"
          activeKey={tab}
          items={[
            { key: 'scouts', label: 'By Scout', onSelect: () => setTab('scouts') },
            { key: 'roster', label: 'Teaching Roster', onSelect: () => setTab('roster') }
          ]}
        />
      </div>

      <div className={styles.generateBar}>
        <label className={styles.field}>
          Meeting date
          <DatePickerField value={meetingDate} onChange={setMeetingDate} />
        </label>
        <Button variant="primary" onClick={show} disabled={isPending || !meetingDate}>
          {isPending ? 'Working…' : 'Show'}
        </Button>
        {status ? <span className={styles.statusErr}>{status}</span> : null}
      </div>

      {payload && (
        <>
          <div className={styles.statsStrip}>
            <Stat n={payload.stats.scoutsWithSuggestions} label="Scouts with suggestions" />
            <Stat n={payload.stats.outingItems} label="Items waiting on a campout" />
          </div>

          {tab === 'scouts' && <ScoutsTab payload={payload} />}
          {tab === 'roster' && <RosterTab payload={payload} />}
        </>
      )}
    </>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statNum}>{n}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function ScoutsTab({ payload }: { payload: MeetingPlanPayload }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.colScout}>Scout</th>
          <th className={styles.colRank}>Rank</th>
          <th>Suggested this meeting (max 3)</th>
          <th className={styles.colCampout}>Waiting on a campout</th>
        </tr>
      </thead>
      <tbody>
        {payload.byScout.map((row) => (
          <tr key={row.scout.id}>
            <td>
              <span className={styles.scoutName}>{row.scout.name}</span>
              {row.scout.patrol && (
                <>
                  <br />
                  <span className={styles.patrol}>{row.scout.patrol}</span>
                </>
              )}
            </td>
            <td>{row.scout.rankLabel}</td>
            <td>
              {row.suggestions.length === 0 ? (
                <span className={styles.needsOuting}>
                  Nothing meeting-doable — campout items only
                </span>
              ) : (
                row.suggestions.map((s, i) => (
                  <div key={i} className={styles.suggestion}>
                    <span className={styles.sCode}>
                      {s.kind === 'mb' ? '★ ' : ''}
                      {s.codeLabel}
                    </span>
                    <span>{s.label}</span>
                  </div>
                ))
              )}
            </td>
            <td className={styles.needsOuting}>
              {row.needsOuting.length === 0
                ? '—'
                : row.needsOuting.map((o, i) => (
                    <div key={i}>
                      <span className={styles.sCode}>{o.codeLabel}</span> {o.label}
                    </div>
                  ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RosterTab({ payload }: { payload: MeetingPlanPayload }) {
  return (
    <div className={styles.rosterCols}>
      <div className={styles.rosterPanel}>
        <h2>Adult Leaders</h2>
        <p className={styles.rosterSub}>
          Matched from leader skills (Lookups &amp; Admin). Adult-instruction skills — First Aid,
          Woods Tools, Fire Safety, Aquatics — are never offered to scout instructors. Read-only here:{' '}
          <Link href="/admin/advancement/lookups">Edit in Lookups</Link>.
        </p>
        {payload.rosterAdults.length === 0 ? (
          <div className={styles.emptyHint}>
            No leader skills recorded yet — add them under Lookups &amp; Admin → Leader Skills.
          </div>
        ) : (
          payload.rosterAdults.map((a) => (
            <div key={a.code} className={styles.leaderRow}>
              <div>
                <div className={styles.leaderName}>{a.name}</div>
                {a.role && <div className={styles.leaderRole}>{a.role}</div>}
              </div>
              <div className={styles.skillChips}>
                {a.skills.map((s) => (
                  <span key={s} className={`${styles.tag} ${styles.tagAdult}`}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.rosterPanelYouth}>
        <h2>Scout Instructors</h2>
        <p className={styles.rosterSub}>
          Star rank and above, authorized per skill (blanket authorization, managed in Lookups
          &amp; Admin). Only youth-teachable skills can be assigned.
        </p>
        {payload.rosterScoutInstructors.length === 0 ? (
          <div className={styles.emptyHint}>
            No scout instructors authorized yet — add them under Lookups &amp; Admin → Scout
            Instructors.
          </div>
        ) : (
          payload.rosterScoutInstructors.map((s) => (
            <div key={s.id} className={styles.leaderRow}>
              <div>
                <div className={styles.leaderName}>{s.name}</div>
                <div className={styles.leaderRole}>{s.rankLabel}</div>
              </div>
              <div className={styles.skillChips}>
                {s.skills.map((sk) => (
                  <span key={sk} className={`${styles.tag} ${styles.tagYouth}`}>
                    {sk}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
        <div className={styles.rosterNote}>
          A scout instructor teaches under an adult&rsquo;s supervision; requirement sign-off
          stays with the leader.
        </div>
      </div>
    </div>
  );
}
