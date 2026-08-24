import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { loadEventDetail } from '@/lib/event-signup';
import { loadSignupContext, signedUpNames } from './signup-context';
import { formatCalendarDateParts, formatTimeOfDay } from '@/lib/calendar-shared';
import { loadCalendarCategories } from '@/lib/calendar';
import { plainSummary } from '@/lib/feed-logic';
import { calendarReturn } from '@/lib/calendar-return';
import { categoryColorMap, colorFor, templateOf } from '@/lib/calendar-categories';
import { getPublicMeetingForEntry, getPublishedMeetingNav } from '@/lib/meetings';
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import { centralToday } from '@/lib/dates';
import { fmtDay } from '@/lib/format-date';
import { MeetingAgenda } from './meeting-agenda';
import { Notice } from '@/app/_components/notice';
import { JsonLd } from '@/app/_components/json-ld';
import { createAdminClient } from '@/lib/supabase/server';
import { siteUrl } from '@/lib/site-url';
import { loadSeoSettings, eventJsonLd, breadcrumbJsonLd } from '@/lib/seo';
import styles from './event-detail.module.css';

/*
 * ONE event page for every event shape (Plans/Event-Signup.md), including
 * meetings since the calendar unification — /meetings/[date] is gone and this
 * is the single permalink for anything on a date.
 *
 * Blocks still render from the event's own configuration: what an entry HAS is
 * what shows. The category's `template` chooses presentation on top of that —
 * a meeting gets the agenda shape instead of the fact grid — but it never gates
 * which layers may exist, so a meeting that grows a signup renders both and
 * needs no conversion. (That distinction is what D-081 was protecting; a stored
 * type that forces a migration is still rejected.)
 *
 * Content above the gate is public; anything that could name a
 * scout or family sits behind it.
 *
 * Phase 1 slice: READ-ONLY. The gate works and the blocks render; the signup
 * form itself is the next step.
 */

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const numeric = parseId(id);
  const detail = numeric ? await loadEventDetail(numeric) : null;
  if (!detail) return { title: 'Event — Scout Troop 79' };
  return {
    title: `${detail.entry.title} — Scout Troop 79`,
    // Flattened and cut, not the raw column: a description can now run to
    // paragraphs, and a meta description carrying newlines and 800 characters
    // is worse than one good sentence.
    description: plainSummary(detail.entry.description) ?? undefined
  };
}

const AUDIENCE_LABEL = { scouts: 'Scouts', adults: 'Adults', both: 'Everyone' } as const;

function money(n: number): string {
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekday from a plain "YYYY-MM-DD" without a local-timezone Date parse,
 *  which would shift the day depending on the server's zone (same approach as
 *  calendar-browser.tsx). */
function weekdayAbbr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAY_ABBR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function dateRange(entryDate: string, endDate: string | null): string {
  const a = formatCalendarDateParts(entryDate);
  const aLabel = `${weekdayAbbr(entryDate)}, ${a.month} ${a.day}`;
  if (!endDate || endDate === entryDate) return aLabel;
  const b = formatCalendarDateParts(endDate);
  return `${aLabel} – ${weekdayAbbr(endDate)}, ${b.month} ${b.day}`;
}

function timeRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  return end ? `${formatTimeOfDay(start)} – ${formatTimeOfDay(end)}` : formatTimeOfDay(start);
}

/** "3 of 6 — 3 more needed" / "Full (6/6)" — always numbers, never a bare "Full". */
function coverage(filled: number, needed: number | null): string {
  if (needed == null) return `${filled} signed up · no limit`;
  if (filled >= needed) return `Full (${needed}/${needed})`;
  return `${filled} of ${needed} — ${needed - filled} more needed`;
}

export default async function EventDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    gate?: string;
    household?: string;
    err?: string;
    saved?: string;
    cancelled?: string;
    signedout?: string;
    /* The calendar position the visitor arrived from — carried by every link
       out of /events so this page can offer a way back to it. Read only by
       calendarReturn(), which allowlists exactly these four. */
    view?: string;
    m?: string;
    category?: string;
    q?: string;
  }>;
}) {
  const { id } = await params;
  const numeric = parseId(id);
  if (!numeric) notFound();

  const [sp, categories] = await Promise.all([searchParams, loadCalendarCategories()]);
  const ctx = await loadSignupContext(numeric, sp.household);
  if (!ctx) notFound();

  const { detail, gatedIn, household, slotFirst, locked } = ctx;
  const { entry, signup, prices, slots, resources, headcount } = detail;
  /* Who in this party already has a live entry — the question the form used to
     answer just by being on this page. See signup-context.ts. */
  const signedUp = signedUpNames(ctx);
  const times = timeRange(entry.start_time, entry.end_time);
  /* Back to the exact view the visitor left — month or list, which month,
     which filter — rather than the top of the calendar. See lib/calendar-return
     for why this is a pure function over params and not history.back(). */
  const back = calendarReturn(sp);

  /*
   * Which template this entry renders through (Calendar unification). The
   * CATEGORY carries it — there is no type column on calendar_entries, because
   * the category is already the type and is already FK'd with ON UPDATE
   * CASCADE, so Patrick can add a category and pick its template without a
   * deploy.
   *
   * A template chooses PRESENTATION only. Every layer this entry actually has
   * still renders: a meeting with a signup shows its agenda AND its signup
   * form, which is why the signup block below is outside this branch.
   */
  const template = templateOf(categories, entry.category);
  const isMeeting = template === 'meeting';
  const [meeting, meetingNav] = isMeeting
    ? await Promise.all([getPublicMeetingForEntry(entry.id), getPublishedMeetingNav()])
    : [null, []];

  const seoSettings = await loadSeoSettings(createAdminClient());
  const origin = siteUrl();

  return (
    <main className={styles.page}>
      {/* Event structured data (2026-08-22). Events are what search engines
          actually surface as a rich result for a local youth organization, so
          this is the highest-value node on the site after Organization — which
          the public layout emits on every page. */}
      <JsonLd
        data={[
          eventJsonLd(
            {
              id: entry.id,
              title: entry.title,
              entry_date: entry.entry_date,
              end_date: entry.end_date,
              location: entry.location,
              summary: plainSummary(entry.description)
            },
            seoSettings,
            origin
          ),
          breadcrumbJsonLd(
            [
              { name: 'Home', path: '/' },
              { name: 'Events', path: '/events' },
              { name: entry.title, path: `/events/${entry.id}` }
            ],
            origin
          )
        ]}
      />
      <p className={styles.breadcrumb}>
        <Link href={back.href}>← {back.label}</Link>
      </p>

      <header className={styles.head}>
        <p className={styles.kicker}>
          {/* dynamic: category color */}
          <span className={styles.cat} style={{ background: colorFor(categoryColorMap(categories), entry.category) }}>
            {entry.category}
          </span>
        </p>
        <h1 className={styles.title}>{entry.title}</h1>
        {entry.description && <p className={styles.dek}>{entry.description}</p>}
      </header>

      {/* The meeting template's glance card carries when/where in its own
          shape, so the fact grid would just repeat it. Everything else keeps
          the standard grid. */}
      {!isMeeting && (
      <dl className={styles.factGrid}>
        <div className={styles.fact}>
          <dt>When</dt>
          <dd>
            {dateRange(entry.entry_date, entry.end_date)}
            {times && <span className={styles.factSub}>{times}</span>}
          </dd>
        </div>
        {entry.location && (
          <div className={styles.fact}>
            <dt>Where</dt>
            <dd>{entry.location}</dd>
          </div>
        )}
        {signup && (
          <div className={styles.fact}>
            <dt>Signup deadline</dt>
            <dd>
              {fmtDay(signup.deadline)}
              <span className={styles.factSub}>{locked ? 'Closed' : 'Open now'}</span>
            </dd>
          </div>
        )}
        {signup && prices.length > 0 && (
          <div className={styles.fact}>
            <dt>Cost</dt>
            <dd>
              {money(Math.min(...prices.map((p) => p.amount)))}
              {prices.length > 1 && <span className={styles.factSub}>varies by tier</span>}
            </dd>
          </div>
        )}
      </dl>
      )}

      {/* The story layer. Now rendered through ArticleBody — the same renderer
          the news editor previews against — so details_md gets real markdown
          plus the {{gallery}}/{{video}} blocks instead of the naive
          split-on-blank-lines paragraphs it had before. */}
      {entry.details_md && (
        <section className={styles.body}>
          <ArticleBody body={entry.details_md} />
        </section>
      )}

      {isMeeting && (
        <MeetingAgenda
          entry={{
            id: entry.id,
            entry_date: entry.entry_date,
            title: entry.title,
            description: entry.description,
            location: entry.location
          }}
          meeting={meeting}
          nav={meetingNav}
          today={centralToday()}
        />
      )}

      {resources.length > 0 && (
        <section className={styles.block}>
          <h2 className={styles.blockHead}>Resources</h2>
          <ul className={styles.resourceList}>
            {resources.map((r) => (
              <li key={r.id}>
                <a href={r.url} target="_blank" rel="noopener noreferrer">
                  {r.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!signup && !isMeeting && (
        <p className={styles.noSignup}>
          No signup is needed for this event — just come.
        </p>
      )}

      {signup && (
        <>
          {signup.needs_ahmr_c && (
            <p className={styles.ahmr}>
              <strong>AHMR Part C required</strong> — this event runs 72+ hours. Parts A, B{' '}
              <em>and</em> C (physician-signed within 12 months) are due before departure.
            </p>
          )}

          {prices.length > 0 && (
            <section className={styles.block}>
              <h2 className={styles.blockHead}>Cost &amp; payment</h2>
              <ul className={styles.tierRows}>
                {prices.map((p) => (
                  <li key={p.id}>
                    <span>
                      <strong>{p.label}</strong>
                      <span className={styles.tierWho}>{AUDIENCE_LABEL[p.applies_to]}</span>
                    </span>
                    <span className={styles.tierAmt}>
                      {money(p.amount)}
                      {p.per === 'day' && <small> per day</small>}
                    </span>
                  </li>
                ))}
              </ul>
              {signup.payment_instructions && (
                <p className={styles.payNote}>{signup.payment_instructions}</p>
              )}
              {/* Deposit schedule & deadlines (Plans/Event-Logistics.md §C):
                  "multi-week deposit schedules are a common occurrence", and so
                  are registration deadlines — say them on the page. */}
              {detail.milestones.length > 0 && (
                <ul className={styles.milestoneList}>
                  {detail.milestones.map((m) => (
                    <li key={m.id}>
                      <span className={styles.milestoneDate}>
                        {new Date(`${m.due_on}T12:00:00`).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </span>
                      <span>
                        <strong>{m.label}</strong>
                        {m.amount != null && <> — {money(m.amount)}</>}
                        {m.applies_to !== 'both' && (
                          <span className={styles.tierWho}>{AUDIENCE_LABEL[m.applies_to]}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {slots.length > 0 && !slotFirst && !household && (
            <section className={styles.block}>
              <h2 className={styles.blockHead}>
                {signup.slots_title ?? (slotFirst ? 'Jobs — who’s still needed' : 'Shifts & tasks')}
              </h2>
              <ul className={styles.slotList}>
                {slots.map((s) => {
                  const full = s.needed != null && s.filled >= s.needed;
                  const pct = s.needed ? Math.min(100, Math.round((s.filled / s.needed) * 100)) : 0;
                  return (
                    <li key={s.id} className={full ? styles.slotFull : undefined}>
                      <div className={styles.slotTop}>
                        <span>
                          <strong>{s.label}</strong>
                          <span className={styles.slotWhen}>
                            {timeRange(s.starts_at, s.ends_at) ?? 'Untimed'}
                            {!s.attendance_required && ' · no attendance needed'}
                          </span>
                        </span>
                        <span className={styles.slotMeta}>
                          <span className={styles.elig}>{AUDIENCE_LABEL[s.eligibility]}</span>
                          <span className={styles.count}>{coverage(s.filled, s.needed)}</span>
                        </span>
                      </div>
                      {/* Full-width row under the header — see slot-first-form
                          for why this can't live inside the title block. */}
                      {s.description && <span className={styles.slotDesc}>{s.description}</span>}
                      <span className={styles.bar}>
                        {/* dynamic: fill percentage */}
                        <span style={{ width: `${pct}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/*
            THE SIGNUP SUMMARY — status and a door, never the form itself.
            The form moved to /events/[id]/signup (step 4 of
            Plans/Calendar-Detail-And-Signup-Split.md).

            The status line is not decoration. The form used to answer "are we
            already signed up?" simply by being here with the family's entries
            in it. Take the form away and a family scanning the calendar has no
            way to tell they already responded — and the predictable result of
            that is a second submission.
          */}
          <section className={styles.block} id="signup">
            <h2 className={styles.blockHead}>Signing up</h2>

            {signup.capacity != null && (
              <p className={styles.capacity}>
                {headcount} of {signup.capacity} spots taken
                {signup.waitlist_enabled && headcount >= signup.capacity && ' — waitlist is open'}
              </p>
            )}

            {locked ? (
              <p className={styles.locked}>
                <strong>Signups are closed for this event.</strong> Contact the Scoutmaster if you
                need to make a change.
              </p>
            ) : (
              <>
                {signedUp.length > 0 && (
                  <Notice tone="success" className={styles.noticeGapBottom}>
                    ✓ You&rsquo;re signed up: <strong>{signedUp.join(', ')}</strong>
                    {/* Own household's placements only — car = the driver's
                        family name, never a phone, email or the full manifest
                        (Plans/Event-Logistics.md §A; Patrick accepted the
                        family gate for this, 2026-08-22). Scouts negotiate
                        rides the day before; this is what stops the havoc. */}
                    {ctx.placements.length > 0 && (
                      <ul className={styles.placementList}>
                        {ctx.placements.map((p) => (
                          <li key={p.entryId}>
                            <strong>{p.personName}</strong> — {p.parts.join(' · ')}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Notice>
                )}
                <p className={styles.signupCta}>
                  <Link href={`/events/${entry.id}/signup`} className={styles.gateBtn}>
                    {signedUp.length > 0 ? 'Change your signup' : 'Sign up'}
                  </Link>
                </p>
                {!gatedIn && (
                  /* Said plainly rather than hiding the button (Patrick): the
                     gate is one shared password, and a family that can't see
                     the control assumes the feature is missing. */
                  <p className={styles.helpNote}>
                    Families sign in with the troop password on the next page.
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
