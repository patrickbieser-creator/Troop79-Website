/**
 * Shared renderer for /meetings and /meetings/[date] — the prototype's
 * meeting display (glance card, pre-meeting, agenda timeline, sidebar)
 * plus the date strip and the state-aware banners (happened / not yet
 * published / no meeting). Server component; the only interactivity is
 * the native <details> requirement toggles.
 */

import Link from 'next/link';
import { formatLongDate } from '@/lib/dates';
import type { PublicMeeting, PublicSession } from '@/lib/meetings';
import styles from './meetings.module.css';

export interface CalendarPlaceholder {
  category: string;
  title: string;
  description: string | null;
  location: string | null;
  day_note: string | null;
}

interface Props {
  date: string;
  meeting: PublicMeeting | null;
  /** Calendar entry for dates with no published agenda. */
  calendarEntry: CalendarPlaceholder | null;
  /** All published dates, ascending. */
  dates: string[];
  defaultDate: string | null;
  today: string;
}

function trackClass(track: string | null): string {
  if (!track) return '';
  const key = track.trim().toLowerCase();
  if (key === 'open advancement') return styles.trackOpenAdvancement;
  if (key === 'merit badge') return styles.trackMeritBadge;
  return '';
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`)
  );
}

export function MeetingView({ date, meeting, calendarEntry, dates, defaultDate, today }: Props) {
  const prev = [...dates].reverse().find((d) => d < date) ?? null;
  const next = dates.find((d) => d > date) ?? null;
  const isDefault = date === defaultDate;
  const isPast = date < today;
  const recentArchive = [...dates].reverse().slice(0, 6);

  return (
    <>
      <div className={styles.pageHeader}>
        <h1>Meetings</h1>
        <div className={styles.pageHeaderMeta}>
          <span>What&rsquo;s happening at Troop 79 meetings &mdash; this week and past weeks.</span>
        </div>
        <div className={styles.pageHeaderRule} />
      </div>

      {/* ── date strip ── */}
      <nav className={styles.dateStrip} aria-label="Meeting dates">
        {prev ? (
          <Link href={`/meetings/${prev}`} className={styles.stripLink}>
            &larr; {shortDate(prev)}
          </Link>
        ) : (
          <span className={styles.stripLinkDisabled}>&larr;</span>
        )}
        <div className={styles.dateStripCenter}>
          <span className={styles.dateStripDate}>
            {formatLongDate(date)}
            {isDefault && !isPast && <span className={styles.thisWeekTag}>This Week</span>}
          </span>
          {!isDefault && defaultDate && (
            <Link href="/meetings" className={styles.backToWeek}>
              Back to this week&rsquo;s meeting
            </Link>
          )}
        </div>
        {next ? (
          <Link href={`/meetings/${next}`} className={styles.stripLink}>
            {shortDate(next)} &rarr;
          </Link>
        ) : (
          <span className={styles.stripLinkDisabled}>&rarr;</span>
        )}
      </nav>

      {isPast && meeting && (
        <div className={styles.banner}>
          <div className={styles.bannerInner}>
            This meeting has already happened &mdash; you&rsquo;re viewing the archive.
          </div>
        </div>
      )}

      {meeting ? (
        <MeetingBody meeting={meeting} recentArchive={recentArchive} currentDate={date} />
      ) : (
        <Placeholder date={date} calendarEntry={calendarEntry} isPast={isPast} />
      )}
    </>
  );
}

function MeetingBody({
  meeting: { meeting, preMeeting, agenda },
  recentArchive,
  currentDate
}: {
  meeting: PublicMeeting;
  recentArchive: string[];
  currentDate: string;
}) {
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${meeting.meeting_date}T12:00:00Z`)
  );
  const monthDay = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${meeting.meeting_date}T12:00:00Z`));

  return (
    <div className={styles.container}>
      <div className={styles.mainCol}>
        {/* ── at a glance ── */}
        <div className={styles.glanceCard}>
          <div className={styles.glanceHeader}>
            <div>
              <div className={styles.glanceDayLabel}>{dayName}</div>
              <div className={styles.glanceDate}>{monthDay}</div>
              {meeting.time_range && <div className={styles.glanceTime}>{meeting.time_range}</div>}
            </div>
            {meeting.uniform && (
              <span
                className={`${styles.uniformBadge} ${
                  meeting.uniform.toLowerCase().includes('a') && !meeting.uniform.toLowerCase().includes('b')
                    ? styles.uniformClassA
                    : ''
                }`}
              >
                {meeting.uniform}
              </span>
            )}
          </div>
          <div className={styles.glanceDetails}>
            {(meeting.location || meeting.location_address) && (
              <div className={styles.glanceItem}>
                <div className={styles.glanceLabel}>Location</div>
                <div className={styles.glanceValue}>
                  {meeting.location}
                  {meeting.location_address && (
                    <>
                      {meeting.location && <br />}
                      {meeting.location_address}
                    </>
                  )}
                </div>
              </div>
            )}
            {meeting.snack && (
              <div className={styles.glanceItem}>
                <div className={styles.glanceLabel}>Snack</div>
                <div className={styles.glanceValue}>{meeting.snack}</div>
              </div>
            )}
            {meeting.flag_ceremony && (
              <div className={styles.glanceItem}>
                <div className={styles.glanceLabel}>Flag Ceremony</div>
                <div className={styles.glanceValue}>{meeting.flag_ceremony}</div>
              </div>
            )}
            {meeting.cleanup && (
              <div className={styles.glanceItem}>
                <div className={styles.glanceLabel}>Cleanup</div>
                <div className={styles.glanceValue}>{meeting.cleanup}</div>
              </div>
            )}
            {meeting.duty_roster_url && (
              <div className={styles.glanceItem}>
                <div className={styles.glanceLabel}>Duty Roster</div>
                <div className={styles.glanceValue}>
                  <a href={meeting.duty_roster_url}>View the full duty roster</a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── before the meeting ── */}
        {preMeeting.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Before the Meeting</div>
            {preMeeting.map((item) => (
              <div key={item.id} className={styles.preCard}>
                {item.time_label && <div className={styles.preTime}>{item.time_label}</div>}
                <div className={styles.preTitle}>{item.title}</div>
                {item.description && <div className={styles.preDesc}>{item.description}</div>}
                {item.contact_name && (
                  <div className={styles.preContact}>Contact: {item.contact_name}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── agenda ── */}
        {agenda.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Meeting Agenda</div>
            <div>
              {agenda.map((item, i) => (
                <AgendaRow
                  key={item.id}
                  item={item}
                  continuation={i > 0 && !!item.time_label && agenda[i - 1].time_label === item.time_label}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <aside className={styles.sidebar}>
        <div className={styles.sideCard}>
          <h4>Quick Contacts</h4>
          <div className={styles.sideItem}>
            <a href="mailto:bsatroop79bg@gmail.com">Mindy Stollenwerk</a>{' '}&mdash; Scoutmaster
          </div>
          <div className={styles.sideItem}>
            <Link href="/admin">Members Login</Link>
          </div>
        </div>
        {recentArchive.length > 1 && (
          <div className={styles.sideCard}>
            <h4>Recent Meetings</h4>
            <ul className={styles.archiveList}>
              {recentArchive.map((d) =>
                d === currentDate ? (
                  <li key={d}>
                    <span className={styles.archiveCurrent}>{formatLongDate(d)}</span>
                  </li>
                ) : (
                  <li key={d}>
                    <Link href={`/meetings/${d}`}>{formatLongDate(d)}</Link>
                  </li>
                )
              )}
            </ul>
          </div>
        )}
        <div className={styles.sideCard}>
          <h4>More</h4>
          <div className={styles.sideItem}>
            <Link href="/events">Troop calendar</Link>
          </div>
          <div className={styles.sideItem}>
            <Link href="/advancement">Advancement tracker</Link>
          </div>
        </div>
      </aside>
    </div>
  );
}

function AgendaRow({ item, continuation }: { item: PublicSession; continuation: boolean }) {
  return (
    <div className={styles.agendaRow}>
      <div className={`${styles.timeCol} ${continuation ? styles.timeContinuation : ''}`}>
        <span className={styles.agendaTime}>{item.time_label ?? ''}</span>
      </div>
      <div className={styles.contentCol}>
        {item.track && <span className={`${styles.trackBadge} ${trackClass(item.track)}`}>{item.track}</span>}
        <div className={styles.itemTitle}>{item.title}</div>
        {item.leader_name && <div className={styles.itemLeader}>Led by {item.leader_name}</div>}
        {item.description && <div className={styles.itemDesc}>{item.description}</div>}
        {item.scouts && item.scouts.length > 0 && (
          <div className={styles.itemScouts}>
            <strong>Scouts:</strong> {item.scouts.join(', ')}
          </div>
        )}
        {item.requirements && item.requirements.length > 0 && (
          <details className={styles.reqDetails}>
            <summary className={styles.reqSummary}>View Requirements</summary>
            <div className={styles.reqContent}>
              {item.requirements.map((r, i) => (
                <div key={i} className={styles.reqItem}>
                  <div className={styles.reqId}>{r.code}</div>
                  <div className={styles.reqText}>{r.label}</div>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function Placeholder({
  date,
  calendarEntry,
  isPast
}: {
  date: string;
  calendarEntry: CalendarPlaceholder | null;
  isPast: boolean;
}) {
  const noMeeting = calendarEntry?.category === 'No Meeting';
  return (
    <div className={styles.noMeetingWrap}>
      <div className={styles.noMeetingCard}>
        <div className={styles.noMeetingDate}>{formatLongDate(date)}</div>
        {noMeeting ? (
          <>
            <div className={styles.noMeetingReason}>{calendarEntry?.title || 'No meeting'}</div>
            <p className={styles.noMeetingMsg}>
              {calendarEntry?.description ??
                'There is no troop meeting this week. Check the calendar for what’s next.'}
            </p>
          </>
        ) : isPast ? (
          <p className={styles.noMeetingMsg}>No agenda was published for this date.</p>
        ) : (
          <>
            {calendarEntry && <div className={styles.noMeetingReason}>{calendarEntry.title}</div>}
            <p className={styles.noMeetingMsg}>
              The agenda for this meeting hasn&rsquo;t been published yet &mdash; check back soon.
              {calendarEntry?.location && (
                <>
                  <br />
                  Location: {calendarEntry.location}
                </>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
