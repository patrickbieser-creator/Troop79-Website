import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { loadEventDetail, isSlotFirst, signupLocked } from '@/lib/event-signup';
import { gateAudience, familyGateConfigured } from '@/lib/family-access';
import { formatCalendarDateParts, formatTimeOfDay, categoryColor } from '@/lib/calendar-shared';
import { familyGateAction, familySignOutAction } from './actions';
import styles from './event-detail.module.css';

/*
 * ONE generic event page for every event shape (Plans/Event-Signup.md).
 * Blocks render from the event's own configuration — there is no per-category
 * template. Content above the gate is public; anything that could name a
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
  searchParams: Promise<{ gate?: string }>;
}) {
  const { id } = await params;
  const numeric = parseId(id);
  if (!numeric) notFound();

  const [detail, audience, { gate: gateError }] = await Promise.all([
    loadEventDetail(numeric),
    gateAudience(),
    searchParams
  ]);
  if (!detail) notFound();

  const { entry, signup, prices, slots, resources, headcount } = detail;
  const gatedIn = audience !== null;
  const slotFirst = isSlotFirst(signup, slots);
  const locked = signup ? signupLocked(signup) : false;
  const times = timeRange(entry.start_time, entry.end_time);
  const backHref = '/events';

  return (
    <main className={styles.page}>
      <p className={styles.breadcrumb}>
        <Link href={backHref}>← All events</Link>
      </p>

      <header className={styles.head}>
        <p className={styles.kicker}>
          <span className={styles.cat} style={{ background: categoryColor(entry.category) }}>
            {entry.category}
          </span>
        </p>
        <h1 className={styles.title}>{entry.title}</h1>
        {entry.description && <p className={styles.dek}>{entry.description}</p>}
      </header>

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

      {entry.details_md && (
        <section className={styles.body}>
          {entry.details_md.split(/\n{2,}/).map((para: string, i: number) => (
            <p key={i}>{para}</p>
          ))}
        </section>
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

      {!signup && (
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

          {slots.length > 0 && (
            <section className={styles.block}>
              <h2 className={styles.blockHead}>
                {slotFirst ? 'Jobs — who’s still needed' : 'Shifts &amp; tasks'}
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
                      <span className={styles.bar}>
                        <span style={{ width: `${pct}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
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
                <p className={styles.gateOk}>
                  ✓ You’re signed in as {audience === 'family' ? 'a family' : `a ${audience}`}.
                </p>
                <p className={styles.stub}>
                  The signup form lands here next.{' '}
                  {slotFirst
                    ? 'This event is job-first: you’ll pick a job and say who’s doing it.'
                    : 'You’ll RSVP each person in your household in one submission.'}
                </p>
                <form action={familySignOutAction}>
                  <input type="hidden" name="next" value={`/events/${entry.id}`} />
                  <button type="submit" className={styles.linkBtn}>
                    Sign out of the family gate
                  </button>
                </form>
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
