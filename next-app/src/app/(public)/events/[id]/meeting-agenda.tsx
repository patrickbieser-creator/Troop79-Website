/**
 * The `meeting` template's body — the glance card, pre-meeting items and
 * agenda timeline that used to live at /meetings/[date].
 *
 * Re-parented, not rewritten (Calendar unification, 2026-08-14). Meetings are
 * now a layer on a calendar entry, so this renders inside /events/[id] beside
 * whatever other layers that entry carries; a meeting with a signup shows both.
 * The page shell (breadcrumb, category chip, title, resources, signup) belongs
 * to the event page — this component owns only the agenda-shaped middle.
 *
 * What changed beyond the move: every link is keyed by entry id rather than by
 * date, because a date can now hold more than one meeting and no date-keyed URL
 * can address them. The old page header, "back to this week" link and Quick
 * Contacts sidebar are gone with the standalone /meetings section.
 */

import Link from 'next/link';
import { formatLongDate } from '@/lib/dates';
import type { MeetingNavItem, PublicMeeting, PublicSession } from '@/lib/meetings';
import styles from './meeting-agenda.module.css';

interface Props {
  /** The entry being viewed — its date, and the copy the placeholder falls
   *  back to when no agenda is published yet. */
  entry: {
    id: number;
    entry_date: string;
    title: string;
    description: string | null;
    location: string | null;
  };
  meeting: PublicMeeting | null;
  /** Resolved from the category's BEHAVIOR flag by the page, never by comparing
   *  a label here — a rename would break that (D-082/D-085). */
  /** Published meetings, ascending, for the prev/next strip and archive list. */
  nav: MeetingNavItem[];
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

export function MeetingAgenda({ entry, meeting, nav, today }: Props) {
  const date = entry.entry_date;
  // Position within the published set is by DATE, but every link is by ENTRY —
  // two meetings on one night are two neighbours, not one ambiguous date.
  const idx = nav.findIndex((n) => n.entryId === entry.id);
  const prev = idx > 0 ? nav[idx - 1] : ([...nav].reverse().find((n) => n.date < date) ?? null);
  const next =
    idx >= 0 && idx < nav.length - 1 ? nav[idx + 1] : (nav.find((n) => n.date > date) ?? null);
  const isPast = date < today;
  const recentArchive = [...nav].reverse().slice(0, 6);

  return (
    <>
      <nav className={styles.dateStrip} aria-label="Meeting dates">
        {prev ? (
          <Link href={`/events/${prev.entryId}`} className={styles.stripLink}>
            &larr; {shortDate(prev.date)}
          </Link>
        ) : (
          <span className={styles.stripLinkDisabled}>&larr;</span>
        )}
        <div className={styles.dateStripCenter}>
          <span className={styles.dateStripDate}>{formatLongDate(date)}</span>
        </div>
        {next ? (
          <Link href={`/events/${next.entryId}`} className={styles.stripLink}>
            {shortDate(next.date)} &rarr;
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
        <MeetingBody meeting={meeting} date={date} />
      ) : (
        <Placeholder entry={entry} isPast={isPast} />
      )}

      {recentArchive.length > 1 && (
        <section className={styles.archiveSection}>
          <div className={styles.sectionLabel}>Recent Meetings</div>
          <ul className={styles.archiveList}>
            {recentArchive.map((n) =>
              n.entryId === entry.id ? (
                <li key={n.entryId}>
                  <span className={styles.archiveCurrent}>{formatLongDate(n.date)}</span>
                </li>
              ) : (
                <li key={n.entryId}>
                  <Link href={`/events/${n.entryId}`}>{formatLongDate(n.date)}</Link>
                </li>
              )
            )}
          </ul>
        </section>
      )}
    </>
  );
}

function MeetingBody({ meeting: { meeting, preMeeting, agenda }, date }: { meeting: PublicMeeting; date: string }) {
  // The date comes from the ENTRY, not from meetings.meeting_date — the entry
  // owns the date now, and that column is on its way out.
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`)
  );
  const monthDay = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${date}T12:00:00Z`));

  return (
    <div className={styles.mainCol}>
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

      {preMeeting.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Before the Meeting</div>
          {preMeeting.map((item) => (
            <div key={item.id} className={styles.preCard}>
              {item.time_label && <div className={styles.preTime}>{item.time_label}</div>}
              <div className={styles.preTitle}>{item.title}</div>
              {item.description && <div className={styles.preDesc}>{item.description}</div>}
              {item.contact_name && <div className={styles.preContact}>Contact: {item.contact_name}</div>}
            </div>
          ))}
        </div>
      )}

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

function Placeholder({ entry, isPast }: { entry: Props['entry']; isPast: boolean }) {
  // A meeting with no agenda. A week with no meeting is just a Troop Meeting
  // titled "No Troop Meeting" (Patrick, 2026-08-23 — the "No Meeting"
  // category is retired), so there is no special card: the title says it, and
  // whatever the entry's description says ("Memorial Day Weekend") is shown
  // in place of the agenda — generically, for any agenda-less meeting.
  return (
    <div className={styles.noMeetingWrap}>
      <div className={styles.noMeetingCard}>
        <div className={styles.noMeetingDate}>{formatLongDate(entry.entry_date)}</div>
        {entry.description ? (
          <>
            <div className={styles.noMeetingReason}>{entry.title}</div>
            <p className={styles.noMeetingMsg}>{entry.description}</p>
          </>
        ) : isPast ? (
          <p className={styles.noMeetingMsg}>No agenda was published for this date.</p>
        ) : (
          <p className={styles.noMeetingMsg}>
            The agenda for this meeting hasn&rsquo;t been published yet &mdash; check back soon.
            {entry.location && (
              <>
                <br />
                Location: {entry.location}
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
