'use client';

import { useState, useTransition } from 'react';
import {
  TIER_LABEL,
  TIER_NOTE,
  type MeetingPlanPayload,
  type PlanSession,
  type TierId
} from '@/lib/meeting-plan-types';
import { generatePlan, publishPlan, unpublishPlan } from './actions';
import styles from './meeting-plan.module.css';

export interface PublishedPlanRow {
  meeting_date: string;
  title: string;
  generated_at: string;
  generated_by: string | null;
}

interface Props {
  published: PublishedPlanRow[];
  /** Next Sunday — the troop's meeting day. */
  defaultDate: string;
}

const TIERS: TierId[] = ['new', 'experienced', 'older'];

export function PlanView({ published, defaultDate }: Props) {
  const [meetingDate, setMeetingDate] = useState(defaultDate);
  const [payload, setPayload] = useState<MeetingPlanPayload | null>(null);
  const [tab, setTab] = useState<'sessions' | 'scouts' | 'roster'>('sessions');
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function generate() {
    if (!meetingDate) return;
    setStatus(null);
    const fd = new FormData();
    fd.set('meetingDate', meetingDate);
    fd.set('title', 'Troop Meeting');
    startTransition(async () => {
      const res = await generatePlan(fd);
      if (!res.ok || !res.payload) {
        setStatus({ ok: false, msg: res.error ?? 'Generation failed' });
        return;
      }
      setPayload(res.payload);
      setTab('sessions');
    });
  }

  function publish() {
    if (!payload) return;
    setStatus(null);
    const fd = new FormData();
    fd.set('payload', JSON.stringify(payload));
    startTransition(async () => {
      const res = await publishPlan(fd);
      setStatus(
        res.ok
          ? { ok: true, msg: `Published for ${payload.meetingDate} — live on /meeting-plan` }
          : { ok: false, msg: res.error ?? 'Publish failed' }
      );
    });
  }

  function unpublish(date: string) {
    if (!window.confirm(`Remove the published plan for ${date}?`)) return;
    const fd = new FormData();
    fd.set('meetingDate', date);
    startTransition(async () => {
      const res = await unpublishPlan(fd);
      if (!res.ok) setStatus({ ok: false, msg: res.error ?? 'Remove failed' });
    });
  }

  return (
    <>
      <div className={styles.generateBar}>
        <label className={styles.field}>
          Meeting date
          <input
            type="date"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={styles.generateBtn}
          onClick={generate}
          disabled={isPending || !meetingDate}
        >
          {isPending ? 'Working…' : 'Generate Plan'}
        </button>
        {payload && (
          <button type="button" className={styles.publishBtn} onClick={publish} disabled={isPending}>
            Publish to Site
          </button>
        )}
        {status && (
          <span className={status.ok ? styles.statusOk : styles.statusErr}>{status.msg}</span>
        )}
        {!payload && !status && (
          <span className={styles.barNote}>
            On demand — themed MB nights and campout-prep meetings can simply skip this.
          </span>
        )}
      </div>

      {payload && (
        <>
          <div className={styles.statsStrip}>
            <Stat n={payload.stats.scoutsWithSuggestions} label="Scouts with suggestions" />
            <Stat n={payload.stats.sessions} label="Group sessions" />
            <Stat n={payload.stats.adultsMatched} label="Adult teachers matched" />
            <Stat n={payload.stats.scoutInstructors} label="Scout instructors" />
            <Stat n={payload.stats.outingItems} label="Items waiting on a campout" />
          </div>

          <div className={styles.tabs}>
            <TabBtn active={tab === 'sessions'} onClick={() => setTab('sessions')} label="Group Sessions" />
            <TabBtn active={tab === 'scouts'} onClick={() => setTab('scouts')} label="By Scout" />
            <TabBtn active={tab === 'roster'} onClick={() => setTab('roster')} label="Teaching Roster" />
          </div>

          {tab === 'sessions' && <SessionsTab payload={payload} />}
          {tab === 'scouts' && <ScoutsTab payload={payload} />}
          {tab === 'roster' && <RosterTab payload={payload} />}
        </>
      )}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Published Plans</h2>
        {published.length === 0 ? (
          <div className={styles.empty}>
            Nothing published yet. Generate a plan above, review it, then Publish to Site.
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Meeting Date</th>
                <th>Title</th>
                <th>Generated</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {published.map((p) => (
                <tr key={p.meeting_date}>
                  <td className={styles.scoutName}>{p.meeting_date}</td>
                  <td>{p.title}</td>
                  <td className={styles.needsOuting}>
                    {new Date(p.generated_at).toLocaleString()}
                    {p.generated_by ? ` · ${p.generated_by}` : ''}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      onClick={() => unpublish(p.meeting_date)}
                      disabled={isPending}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`${styles.tabBtn} ${active ? styles.tabBtnActive : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function SessionsTab({ payload }: { payload: MeetingPlanPayload }) {
  return (
    <>
      {TIERS.map((tier) => {
        const sessions = payload.sessions.filter((s) => s.tier === tier);
        if (sessions.length === 0) return null;
        return (
          <div key={tier}>
            <div className={styles.tierHead}>
              <h2>{TIER_LABEL[tier]}</h2>
              <span className={styles.tierNote}>{TIER_NOTE[tier]}</span>
            </div>
            <div className={styles.sessionGrid}>
              {sessions.map((s) => (
                <SessionCard key={s.id} session={s} />
              ))}
            </div>
          </div>
        );
      })}
      {payload.sessions.length === 0 && (
        <div className={styles.empty}>
          No shared requirements this week — check the By Scout tab for individual suggestions.
        </div>
      )}
    </>
  );
}

function SessionCard({ session }: { session: PlanSession }) {
  const hasTeacher =
    session.adultTeachers.length > 0 ||
    session.counselors.length > 0 ||
    session.scoutTeachers.length > 0;
  return (
    <article className={styles.sessionCard}>
      <span className={styles.sessionNum}>
        Session {session.id}
        {session.groupPart ? ` · Group ${session.groupPart}` : ''}
        {session.kind === 'mb' ? ' · Merit Badge' : ''}
      </span>
      <span className={styles.reqCode}>{session.codeLabel}</span>
      <h3>{session.title}</h3>
      {(session.eagle || session.youthTeachable || session.adultOnly) && (
        <div className={styles.tagRow}>
          {session.eagle && <span className={`${styles.tag} ${styles.tagEagle}`}>★ Eagle-required</span>}
          {session.youthTeachable && (
            <span className={`${styles.tag} ${styles.tagYouth}`}>Older scout may teach</span>
          )}
          {session.adultOnly && <span className={`${styles.tag} ${styles.tagAdult}`}>Adults only</span>}
        </div>
      )}
      <div className={styles.chips}>
        {session.scouts.map((s) => (
          <span key={s.id} className={styles.chip}>
            {s.name} <span className={styles.chipRank}>· {s.rankLabel}</span>
          </span>
        ))}
      </div>
      <div className={styles.teachSlot}>
        <span className={styles.teachLabel}>{session.kind === 'mb' ? 'Counselor' : 'Teaching'}</span>
        {hasTeacher ? (
          <>
            {session.scoutTeachers.map((t) => (
              <div key={t.id}>
                <span className={styles.teacher}>{t.name}</span>{' '}
                <span className={styles.teachMeta}>· {t.rankLabel} · scout instructor</span>
              </div>
            ))}
            {[...session.counselors, ...session.adultTeachers].map((t) => (
              <div key={t.code}>
                <span className={styles.teacher}>{t.name}</span>{' '}
                <span className={styles.teachMeta}>
                  · {session.kind === 'mb' ? 'MB counselor' : 'adult leader'}
                </span>
              </div>
            ))}
          </>
        ) : session.skillId ? (
          <span className={styles.noTeacher}>
            No teacher matched — assign the {session.skillName} skill in Lookups &amp; Admin
          </span>
        ) : (
          <span className={styles.teachMeta}>
            Any leader — no specific skill required
          </span>
        )}
      </div>
    </article>
  );
}

function ScoutsTab({ payload }: { payload: MeetingPlanPayload }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th style={{ width: '18%' }}>Scout</th>
          <th style={{ width: '12%' }}>Rank</th>
          <th>Suggested this meeting (max 3)</th>
          <th style={{ width: '28%' }}>Waiting on a campout</th>
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
                    {s.sessionId != null && (
                      <span className={styles.sRef}>→ Session {s.sessionId}</span>
                    )}
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
          Woods Tools, Fire Safety, Aquatics — are never offered to scout instructors.
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
                <div className={styles.tonight}>
                  {a.sessionIds.length > 0
                    ? `Tonight: Session${a.sessionIds.length > 1 ? 's' : ''} ${a.sessionIds.join(', ')}`
                    : 'Not matched tonight — available as backup'}
                </div>
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
                <div className={styles.tonight}>
                  {s.sessionIds.length > 0
                    ? `Tonight: Session${s.sessionIds.length > 1 ? 's' : ''} ${s.sessionIds.join(', ')}`
                    : 'Not matched tonight'}
                </div>
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
