/**
 * /meeting-plan — this week's suggested advancement, for scouts and families.
 *
 * Renders the published `meeting_plans` snapshot for the next upcoming
 * meeting date (RLS exposes published rows only — the anon client can't see
 * drafts). Scout names show as first name + last initial. When no plan is
 * published — themed MB nights, campout-prep weeks — an empty state explains
 * why.
 */

import { createAdminClient } from '@/lib/supabase/server';
import {
  publicName,
  TIER_LABEL,
  TIER_NOTE,
  type MeetingPlanPayload,
  type PlanSession,
  type TierId
} from '@/lib/meeting-plan-types';
import styles from './meeting-plan.module.css';

export const metadata = {
  title: 'Meeting Plan — Scout Troop 79',
  description:
    'Suggested advancement for the next troop meeting — what each scout could work on, and the group skill sessions on offer.'
};

const TIERS: TierId[] = ['new', 'experienced', 'older'];

function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function loadPlan(): Promise<MeetingPlanPayload | null> {
  const supabase = createAdminClient();
  const today = localToday();
  const { data, error } = await supabase
    .from('meeting_plans')
    .select('payload')
    .gte('meeting_date', today)
    .order('meeting_date', { ascending: true })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0].payload as MeetingPlanPayload;
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

export default async function PublicMeetingPlanPage() {
  const plan = await loadPlan();

  return (
    <>
      <div className={styles.pageHeader}>
        <h1>This Week&rsquo;s Meeting Plan</h1>
        <p className={styles.pageHeaderLede}>
          What each scout could work on at the next troop meeting, straight from the
          advancement records — grouped into small skill sessions with a teacher lined up.
          Campout-only requirements are listed separately so nothing falls off the radar.
        </p>
        {plan && (
          <p className={styles.meetingMeta}>
            <strong>{prettyDate(plan.meetingDate)}</strong> &nbsp;&middot;&nbsp; {plan.title}
          </p>
        )}
        <div className={styles.pageHeaderRule} />
      </div>

      <main className={styles.main}>
        {!plan ? (
          <div className={styles.empty}>
            No advancement plan is published for the next meeting — it may be a themed
            merit-badge night or campout prep. Check back next week, or see the{' '}
            <a href="/advancement">Advancement Tracker</a> for overall progress.
          </div>
        ) : (
          <>
            <SectionDivider label="Group Sessions" />
            {TIERS.map((tier) => {
              const sessions = plan.sessions.filter((s) => s.tier === tier);
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

            <SectionDivider label="By Scout" />
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: '18%' }}>Scout</th>
                    <th style={{ width: '13%' }}>Rank</th>
                    <th>Suggested this meeting</th>
                    <th style={{ width: '27%' }}>Waiting on a campout</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.byScout.map((row) => (
                    <tr key={row.scout.id}>
                      <td>
                        <span className={styles.scoutName}>{publicName(row.scout.name)}</span>
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
            </div>

            <p className={styles.footnote}>
              Suggestions are a starting point, not homework — show up, pick something, and a
              leader or scout instructor will help. Requirement sign-off always happens with a
              leader at the meeting.
            </p>
          </>
        )}
      </main>
    </>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className={styles.sectionDivider}>
      <span className={styles.divLabel}>{label}</span>
      <span className={styles.divRule} aria-hidden="true" />
    </div>
  );
}

function SessionCard({ session }: { session: PlanSession }) {
  const teachers = [...session.scoutTeachers.map((t) => ({ key: t.id, name: publicName(t.name), meta: `${t.rankLabel} · scout instructor` }))];
  for (const t of [...session.counselors, ...session.adultTeachers]) {
    teachers.push({
      key: t.code,
      name: t.name,
      meta: session.kind === 'mb' ? 'merit badge counselor' : 'adult leader'
    });
  }
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
            {publicName(s.name)}
          </span>
        ))}
      </div>
      <div className={styles.teachSlot}>
        <span className={styles.teachLabel}>{session.kind === 'mb' ? 'Counselor' : 'Teaching'}</span>
        {teachers.length === 0 ? (
          <span className={styles.teachMeta}>Teacher to be arranged at the meeting</span>
        ) : (
          teachers.map((t) => (
            <div key={t.key}>
              <span className={styles.teacher}>{t.name}</span>{' '}
              <span className={styles.teachMeta}>· {t.meta}</span>
            </div>
          ))
        )}
      </div>
    </article>
  );
}
