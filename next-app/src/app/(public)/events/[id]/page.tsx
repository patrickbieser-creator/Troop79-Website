import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  loadEventDetail,
  loadPartySignup,
  isSlotFirst,
  signupLocked
} from '@/lib/event-signup';
import { householdKeyForPerson, loadHouseholds, storedHouseholdId } from '@/lib/households';
import { gateAudience, familyGateConfigured, getIdentitySessionIfValid } from '@/lib/family-access';
import { resolveEffectiveHouseholdKey } from '@/lib/identity-session';
import { leaderSessionPersonId } from '@/lib/session-person';
import { formatCalendarDateParts, formatTimeOfDay } from '@/lib/calendar-shared';
import { loadCalendarCategories } from '@/lib/calendar';
import { behaviorOf, categoryColorMap, colorFor, templateOf } from '@/lib/calendar-categories';
import { getPublicMeetingForEntry, getPublishedMeetingNav } from '@/lib/meetings';
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import { centralToday } from '@/lib/dates';
import { MeetingAgenda } from './meeting-agenda';
import {
  familyGateAction,
  familySignOutAction,
  submitSignupAction,
  cancelSignupAction
} from './actions';
import HouseholdPicker from './household-picker';
import SlotFirstForm from './slot-first-form';
import PersonFirstForm from './person-first-form';
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
    description: detail.entry.description ?? undefined
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
  }>;
}) {
  const { id } = await params;
  const numeric = parseId(id);
  if (!numeric) notFound();

  const [detail, audience, sp, categories] = await Promise.all([
    loadEventDetail(numeric),
    gateAudience(),
    searchParams,
    loadCalendarCategories()
  ]);
  if (!detail) notFound();

  const {
    gate: gateError,
    household: householdKeyParam,
    err: formError,
    saved,
    cancelled,
    signedout
  } = sp;
  const { entry, signup, prices, slots, questions, resources, headcount } = detail;
  const gatedIn = audience !== null;
  const slotFirst = isSlotFirst(signup, slots);

  // Household roster and any existing entries are gate-only: they carry names.
  const households = gatedIn && signup ? await loadHouseholds() : [];

  // Identity prefill (Plans/Family-Identity-Auth.md Phase 2) — see
  // resolveEffectiveHouseholdKey()'s own doc for the undefined-vs-empty
  // distinction that keeps the "Not you? Change" switch affordance working.
  //
  // Both session shapes that identify a PERSON feed this, not just the
  // verified-household one. gateAudience() checks the leader cookie FIRST and
  // returns its role, so a signed-in leader is 'leader' and never 'household'
  // — which meant the prefill was skipped for the most strongly authenticated
  // visitor on the site. A leader logs in by matching the authorized-adults
  // roster, so the system knows exactly who they are, yet the job board still
  // opened on "choose your family" with no way to just sign themselves up.
  const verifiedSession = audience === 'household' ? await getIdentitySessionIfValid() : null;
  const sessionPersonId = verifiedSession?.personId ?? (audience === 'leader' ? await leaderSessionPersonId() : null);
  // Resolved against the already-loaded roster rather than
  // resolveHouseholdKeyForPerson(), which would load every household a second
  // time on a page that has them in hand.
  const sessionHouseholdKey =
    verifiedSession?.householdKey ??
    (sessionPersonId != null ? householdKeyForPerson(households, sessionPersonId) : null);
  const householdKey = resolveEffectiveHouseholdKey(householdKeyParam, sessionHouseholdKey);

  const household = householdKey ? (households.find((h) => h.key === householdKey) ?? null) : null;
  // "scout:<id>" (unassigned scout) and "leader:<code>" (adult with no scout in
  // the troop) parties have no stored household row, so their entries carry a
  // null household_id and are found by identity instead.
  const householdIdNum = storedHouseholdId(household?.key);
  const existing =
    household && signup
      ? await loadPartySignup(signup.id, householdIdNum, {
          personIds: [
            ...household.scouts.map((s) => s.personId).filter((v): v is number => v != null),
            ...household.adults.map((a) => a.personId)
          ]
        })
      : [];

  // Map stored entries back to the form's person keys (s0/s1…, a0/a1…).
  // person_id is the whole match now — the scout_id / scout_parent_id /
  // leader_code fallbacks went with their columns (D-066), and every entry has
  // carried a person_id since the re-key made it NOT NULL.
  const existingClaims = household
    ? existing.flatMap((e) => {
        let key: string | null = null;
        const si = household.scouts.findIndex((s) => s.personId === e.person_id);
        if (si >= 0) key = `s${si}`;
        const ai = household.adults.findIndex((a) => a.personId === e.person_id);
        if (ai >= 0) key = `a${ai}`;
        return key
          ? e.claims.map((slotId) => ({
              slotId,
              personKey: key!,
              comment: e.claimComments[slotId] ?? null
            }))
          : [];
      })
    : [];
  // How far into the flow this visitor is — the job board renders the right
  // prompt inline at whichever job they click, instead of sending them to
  // the bottom of a 30-job page.
  const gateState: 'anon' | 'no-household' | 'ready' = !gatedIn
    ? 'anon'
    : household
      ? 'ready'
      : 'no-household';
  const locked = signup ? signupLocked(signup) : false;
  const times = timeRange(entry.start_time, entry.end_time);
  const backHref = '/events';

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

  return (
    <main className={styles.page}>
      <p className={styles.breadcrumb}>
        <Link href={backHref}>← All events</Link>
      </p>

      <header className={styles.head}>
        <p className={styles.kicker}>
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
              {new Date(signup.deadline).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric'
              })}
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
          isNoMeeting={behaviorOf(categories, entry.category) === 'no_meeting'}
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
                        <span style={{ width: `${pct}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

      {signup && slotFirst && !locked && (
        <section className={styles.block}>
          <h2 className={styles.blockHead}>{signup.slots_title ?? 'Jobs — pick one to sign up'}</h2>
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
            gateError={gateError}
            gateConfigured={familyGateConfigured()}
          />
        </section>
      )}

          <section className={styles.block}>
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
            ) : gatedIn ? (
              <div className={styles.gatedIn}>
                {saved && (
                  <p className={styles.savedNote}>
                    ✓ Your signup is saved. You can come back and change it until the deadline.
                  </p>
                )}
                {signedout && (
                  <p className={styles.savedNote}>
                    ✓ Signed out of the family gate on this device.
                  </p>
                )}
                {cancelled && (
                  <p className={styles.savedNote}>
                    Your signup was cancelled and your spots went back to the pool.
                  </p>
                )}
                {formError && <p className={styles.gateErr}>{formError}</p>}

                {!household ? (
                  <>
                    <p className={styles.gateOk}>
                      ✓ You’re signed in
                      {slotFirst ? ' — pick a job above to find yourself.' : ' — now find yourself.'}
                    </p>
                    {!slotFirst && <HouseholdPicker households={households} eventId={entry.id} />}
                  </>
                ) : (
                  <>
                    <p className={styles.householdBar}>
                      <span>
                        {/* A standalone adult has no household to name — saying
                            "the Jane Smith household" would read as a bug. */}
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
                          verified visitor's household prefill only fires when the
                          param is absent (see the page's householdKey resolution
                          above); an EXPLICIT empty value is how "switching" stays
                          possible instead of the prefill immediately winning it
                          back on the very next render. */}
                      <Link href={`/events/${entry.id}?household=`} className={styles.linkBtn}>
                        Not you? Change
                      </Link>
                    </p>

                    {slotFirst ? (
                      <p className={styles.stub}>
                        Your jobs are in the list above — pick any job to add or change who’s
                        doing it.
                      </p>
                    ) : (
                      <PersonFirstForm
                        eventId={entry.id}
                        signup={signup}
                        household={household}
                        prices={prices}
                        questions={questions}
                        slots={slots}
                        existingClaims={existingClaims}
                        existing={existing}
                        submitAction={submitSignupAction}
                        cancelAction={cancelSignupAction}
                      />
                    )}
                  </>
                )}

                {audience === 'family' ? (
                  <form action={familySignOutAction} className={styles.signOutRow}>
                    <input type="hidden" name="next" value={`/events/${entry.id}`} />
                    <button type="submit" className={styles.linkBtn}>
                      Sign out of the family gate
                    </button>
                  </form>
                ) : (
                  /* A leader/scout session already clears the gate, so signing
                     out of the FAMILY cookie would change nothing visible —
                     the button would look broken. Say so instead. */
                  <p className={styles.signOutRow}>
                    <span className={styles.linkBtnQuiet}>
                      You&rsquo;re seeing this as a signed-in {audience}, not through the family
                      gate. To view it as a family would, use a private window or sign out of the
                      admin area.
                    </span>
                  </p>
                )}
              </div>
            ) : !familyGateConfigured() ? (
              <p className={styles.locked}>
                The family signup gate isn’t configured on this server
                (<code>FAMILY_PASSWORD</code> is unset).
              </p>
            ) : (
              <form action={familyGateAction} className={styles.gate}>
                <p className={styles.gateLede}>
                  One shared password for the whole troop — it’s printed in the Bugle each week, or
                  ask any leader. You’ll only enter it once on this device. No account, no email.
                </p>
                <input type="hidden" name="next" value={`/events/${entry.id}`} />
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
                {gateError === 'bad-password' && (
                  <p className={styles.gateErr}>That password didn’t match. Try again.</p>
                )}
                {gateError === 'missing' && (
                  <p className={styles.gateErr}>Please enter the troop password.</p>
                )}
                {gateError === 'not-configured' && (
                  <p className={styles.gateErr}>
                    The family gate isn’t configured on this server.
                  </p>
                )}
              </form>
            )}
          </section>
        </>
      )}
    </main>
  );
}
