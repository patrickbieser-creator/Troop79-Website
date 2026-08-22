import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { familyGateConfigured } from '@/lib/family-access';
import { formatCalendarDateParts, formatTimeOfDay } from '@/lib/calendar-shared';
import { calendarReturn } from '@/lib/calendar-return';
import { loadSignupContext } from '../signup-context';
import {
  familyGateAction,
  familySignOutAction,
  submitSignupAction,
  cancelSignupAction
} from '../actions';
import HouseholdPicker from '../household-picker';
import SlotFirstForm from '../slot-first-form';
import PersonFirstForm from '../person-first-form';
import { TrackOnMount } from '../../../_components/track-on-mount';
import { Notice } from '@/app/_components/notice';
import styles from '../event-detail.module.css';

/*
 * SIGNING UP, on its own address (step 4 of
 * Plans/Calendar-Detail-And-Signup-Split.md).
 *
 * The event page and this page answer different questions. /events/[id] is
 * what the event IS — the agenda, the cost, the jobs that need filling — and
 * most visitors want only that. This is the commitment, and it is a form, and
 * putting a form under every description made the description feel like
 * paperwork.
 *
 * It repeats when and where in the header on purpose. Not a duplicate of the
 * event page — enough that someone part-way through the form isn't bouncing
 * back to check what time it starts.
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
  const ctx = numeric ? await loadSignupContext(numeric, undefined) : null;
  if (!ctx) return { title: 'Sign up — Scout Troop 79' };
  return {
    title: `Sign up: ${ctx.detail.entry.title} — Scout Troop 79`,
    // A signup form has nothing to offer a search engine, and indexing it
    // would compete with the event's own page for the same query.
    robots: { index: false, follow: true }
  };
}

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

export default async function EventSignupPage({
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
    view?: string;
    m?: string;
    category?: string;
    q?: string;
  }>;
}) {
  const { id } = await params;
  const numeric = parseId(id);
  if (!numeric) notFound();

  const sp = await searchParams;
  const ctx = await loadSignupContext(numeric, sp.household);
  if (!ctx) notFound();

  const { detail, audience, gatedIn, households, household, existing, existingClaims, gateState, slotFirst, locked } = ctx;
  const { entry, signup, prices, slots, questions, headcount } = detail;

  const back = calendarReturn(sp);
  /* Two ways out, and they mean different things: back to the event (what this
     is about) and back to the calendar (where they were browsing). */
  const eventHref = `/events/${entry.id}`;
  const times = timeRange(entry.start_time, entry.end_time);

  /*
   * A signup URL is a bookmark someone will return to — after the deadline,
   * after the event, after signup was switched off entirely. Each of those has
   * to explain itself rather than 404 or, worse, render a form that silently
   * does nothing.
   */
  if (!signup) {
    return (
      <main className={styles.page}>
        <p className={styles.breadcrumb}>
          <Link href={eventHref}>← {entry.title}</Link>
        </p>
        <header className={styles.head}>
          <h1 className={styles.title}>No signup for this event</h1>
        </header>
        <p className={styles.locked}>
          <strong>{entry.title}</strong> doesn&rsquo;t use a signup — just come. The event page has
          the details.
        </p>
        <p className={styles.breadcrumb}>
          <Link href={back.href}>← {back.label}</Link>
        </p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <TrackOnMount event="event_signup_view" params={{ event_id: entry.id }} />
      <p className={styles.breadcrumb}>
        <Link href={eventHref}>← {entry.title}</Link>
      </p>

      <header className={styles.head}>
        <h1 className={styles.title}>Sign up</h1>
        {/* When and where, repeated here so the form stands on its own. */}
        <p className={styles.dek}>
          <strong>{entry.title}</strong> · {dateRange(entry.entry_date, entry.end_date)}
          {times ? ` · ${times}` : ''}
          {entry.location ? ` · ${entry.location}` : ''}
        </p>
      </header>

      {signup.needs_ahmr_c && (
        <p className={styles.ahmr}>
          <strong>AHMR Part C required</strong> — this event runs 72+ hours. Parts A, B{' '}
          <em>and</em> C (physician-signed within 12 months) are due before departure.
        </p>
      )}

      {signup.capacity != null && (
        <p className={styles.capacity}>
          {headcount} of {signup.capacity} spots taken
          {signup.waitlist_enabled && headcount >= signup.capacity && ' — waitlist is open'}
        </p>
      )}

      {locked ? (
        <p className={styles.locked}>
          <strong>Signups are closed for this event.</strong> Contact the Scoutmaster if you need to
          make a change.
        </p>
      ) : !gatedIn ? (
        !familyGateConfigured() ? (
          <p className={styles.locked}>
            The family signup gate isn&rsquo;t configured on this server
            (<code>FAMILY_PASSWORD</code> is unset).
          </p>
        ) : (
          <form action={familyGateAction} className={styles.gate}>
            <p className={styles.gateLede}>
              One shared password for the whole troop — it&rsquo;s printed in the Bugle each week,
              or ask any leader. You&rsquo;ll only enter it once on this device. No account, no
              email.
            </p>
            {/* Back HERE after the gate, not to the event page — the visitor
                clicked "Sign up", and landing them on the description would
                make them find their way back to the form they asked for. */}
            <input type="hidden" name="next" value={`${eventHref}/signup`} />
            <label className={styles.gateLabel} htmlFor="family-password">
              Troop password
            </label>
            <div className={styles.gateRow}>
              <input
                id="family-password"
                name="password"
                type="password"
                autoComplete="off"
                className={styles.gateInput}
                placeholder="Enter the troop password"
              />
              <button type="submit" className={styles.gateBtn}>
                Continue
              </button>
            </div>
            {sp.gate === 'bad-password' && (
              <Notice tone="error" className={styles.noticeGapTop}>That password didn&rsquo;t match. Try again.</Notice>
            )}
            {sp.gate === 'missing' && <Notice tone="error" className={styles.noticeGapTop}>Please enter the troop password.</Notice>}
            {sp.gate === 'not-configured' && (
              <Notice tone="error" className={styles.noticeGapTop}>The family gate isn&rsquo;t configured on this server.</Notice>
            )}
          </form>
        )
      ) : (
        <div className={styles.gatedIn}>
          {sp.saved && (
            <>
              <TrackOnMount event="event_signup_complete" params={{ event_id: entry.id }} />
              <Notice tone="success" className={styles.noticeGapBottom}>
                ✓ Your signup is saved. You can come back and change it until the deadline.
              </Notice>
            </>
          )}
          {sp.signedout && (
            <Notice tone="success" className={styles.noticeGapBottom}>✓ Signed out of the family gate on this device.</Notice>
          )}
          {sp.cancelled && (
            <Notice tone="success" className={styles.noticeGapBottom}>
              Your signup was cancelled and your spots went back to the pool.
            </Notice>
          )}
          {sp.err && <Notice tone="error" className={styles.noticeGapBottom}>{sp.err}</Notice>}

          {!household ? (
            <>
              <p className={styles.gateOk}>
                ✓ You&rsquo;re signed in
                {slotFirst ? ' — pick a job below to find yourself.' : ' — now find yourself.'}
              </p>
              {!slotFirst && <HouseholdPicker households={households} eventId={entry.id} />}
            </>
          ) : (
            <p className={styles.householdBar}>
              <span>
                {/* A standalone adult has no household to name — saying "the
                    Jane Smith household" would read as a bug. */}
                {household.scouts.length === 0 ? (
                  <>
                    Signing up <strong>{household.label}</strong>
                  </>
                ) : (
                  <>
                    Signing up the <strong>{household.label}</strong> household
                  </>
                )}
              </span>
              {/* Explicit ?household= (empty) rather than a bare link — a
                  verified visitor's prefill only fires when the param is
                  ABSENT, so an explicit empty value is how "switching" stays
                  possible instead of the prefill winning it straight back. */}
              <Link href={`${eventHref}/signup?household=`} className={styles.linkBtn}>
                Not you? Change
              </Link>
            </p>
          )}

          {slotFirst ? (
            <section className={styles.block}>
              <h2 className={styles.blockHead}>{signup.slots_title ?? 'Jobs — pick one to sign up'}</h2>
              <TrackOnMount event="event_signup_start" params={{ event_id: entry.id }} />
              <SlotFirstForm
                eventId={entry.id}
                signupId={signup.id}
                household={household}
                households={households}
                slots={slots}
                allowGuests={signup.allow_guests}
                guestPrompt={signup.guest_prompt}
                existingClaims={existingClaims}
                hasExisting={existing.length > 0}
                submitAction={submitSignupAction}
                cancelAction={cancelSignupAction}
                gateAction={familyGateAction}
                signOutAction={familySignOutAction}
                gateState={gateState}
                isFamilySession={audience === 'family'}
                gateError={sp.gate}
                gateConfigured={familyGateConfigured()}
              />
            </section>
          ) : (
            household && (
              <>
                <TrackOnMount event="event_signup_start" params={{ event_id: entry.id }} />
                <PersonFirstForm
                  eventId={entry.id}
                  signup={signup}
                  household={household}
                  prices={prices}
                  questions={questions}
                  slots={slots}
                  existingClaims={existingClaims}
                  existing={existing}
                  groupSets={detail.groupSets}
                  existingMemberships={ctx.memberships}
                  submitAction={submitSignupAction}
                  cancelAction={cancelSignupAction}
                />
              </>
            )
          )}

          {audience === 'family' ? (
            <form action={familySignOutAction} className={styles.signOutRow}>
              <input type="hidden" name="next" value={`${eventHref}/signup`} />
              <button type="submit" className={styles.linkBtn}>
                Sign out of the family gate
              </button>
            </form>
          ) : (
            /* A leader/scout session already clears the gate, so signing out of
               the FAMILY cookie would change nothing visible — the button would
               look broken. Say so instead. */
            <p className={styles.signOutRow}>
              <span className={styles.linkBtnQuiet}>
                You&rsquo;re seeing this as a signed-in {audience}, not through the family gate. To
                view it as a family would, use a private window or sign out of the admin area.
              </span>
            </p>
          )}
        </div>
      )}

      <p className={styles.breadcrumb}>
        <Link href={back.href}>← {back.label}</Link>
      </p>
    </main>
  );
}
