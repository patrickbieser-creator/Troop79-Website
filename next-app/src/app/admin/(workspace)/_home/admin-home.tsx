/**
 * Home (/admin), Plans/Completed/Admin-Portal-Nav.md decisions 5–7, phase 4. Top to bottom:
 *   Needs you today | This week
 *   Your shortcuts (pins first, then what this person opens most)
 *   Reports | At a glance (Active scouts · Troop account · Missing BSA IDs · Uncollected funds)
 *   Recent ledger activity | Likely ready for review
 *   Recent logins (full width)
 * At a glance and the three cards each stream in their own Suspense, so the top never waits on their reads. Every
 * block shows only what the person can open: the registry decides the shortcuts and reports, capabilities decide the
 * money tiles (finance only) and the bottom cards (advancement.write; logins: roster.manage). A block that can't load
 * says so in place.
 */
import { Suspense } from 'react';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveAdminActor } from '@/lib/admin-actor';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { fmtDay } from '@/lib/format-date';
import { formatTimeOfDay } from '@/lib/calendar-shared';
import { attentionCategoriesFor } from './attention-items';
import { PageTitle } from '../_components/page-title';
import { PageSkeleton } from '../_components/page-skeleton';
import { AttentionInbox } from '../_components/attention-inbox';
import { Notice } from '../_components/notice';
import { Button } from '../../_components/button';
import { visibleFeaturesFor } from '../_components/nav-visibility';
import { loadPinKeys } from '../_components/pins-store';
import { mostOpened } from '../_components/nav-events';
import { loadThisWeek, shortcuts, reportsShelf, type ThisWeek, type Shortcut } from './home-data';
import { AtAGlance } from './at-a-glance';
import { RecentLedgerCard, LikelyReadyCard, RecentLoginsCard } from './advancement-cards';
import { SuggestionButton } from './suggestion-button';
import { loadSuggestionActor, sendSuggestionAction } from './suggestion-actions';
import styles from './home.module.css';
import cards from './dashboard.module.css';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function AdminHome() {
  const actor = await resolveAdminActor();
  if (!actor) throw new Error('Not authenticated');
  const sb = createAdminClient();
  const has = (c: Parameters<typeof actor.capabilities.has>[0]) => actor.capabilities.has(c);
  const personId = actor.personId;

  const [visible, rows, suggestionActor, week, pinKeys, opened] = await Promise.all([
    visibleFeaturesFor(actor),
    attentionCategoriesFor(actor.capabilities),
    loadSuggestionActor(),
    loadThisWeek(sb).catch((e: unknown) => {
      console.error('[home] this week:', e instanceof Error ? e.message : e);
      return null;
    }),
    personId != null ? loadPinKeys(sb, personId).catch(() => []) : Promise.resolve([]),
    personId != null ? mostOpened(sb, personId).catch(() => []) : Promise.resolve([])
  ]);
  const shelf = reportsShelf(visible);

  return (
    <div className={styles.home}>
      <PageTitle back={null} title="Home">
        <SuggestionButton actorName={suggestionActor.name} actorEmail={suggestionActor.email} action={sendSuggestionAction} />
      </PageTitle>

      <div className={`${styles.pair} ${styles.pairWide}`}>
        <AttentionInbox rows={rows} />
        <ThisWeekCard week={week} canPlanner={plannerAccess(actor).canView} canCalendar={has('calendar.write')} />
      </div>

      <ShortcutsBlock items={shortcuts(visible, pinKeys, opened)} canPin={personId != null} />

      <div className={styles.pair}>
        <ReportsShelf items={shelf.items} total={shelf.total} />
        <Suspense fallback={<PageSkeleton rows={2} />}>
          <AtAGlance financeView={has('finance.view')} financeManage={has('finance.manage')} canRoster={has('roster.manage')} />
        </Suspense>
      </div>

      {has('advancement.write') ? (
        <div className={styles.pair}>
          <Suspense fallback={<PageSkeleton rows={6} />}>
            <RecentLedgerCard />
          </Suspense>
          <Suspense fallback={<PageSkeleton rows={4} />}>
            <LikelyReadyCard />
          </Suspense>
        </div>
      ) : null}

      {has('roster.manage') ? (
        <div className={cards.grid}>
          <Suspense fallback={<PageSkeleton rows={6} />}>
            <RecentLoginsCard />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}

function ThisWeekCard({ week, canPlanner, canCalendar }: { week: ThisWeek | null; canPlanner: boolean; canCalendar: boolean }) {
  const m = week?.meeting ?? null;
  return (
    <section className={styles.card} aria-labelledby="home-this-week">
      <h2 id="home-this-week" className={styles.heading}>
        This week
      </h2>
      {week == null ? (
        <Notice variant="error">This week&rsquo;s meeting and calendar couldn&rsquo;t be loaded. Reload to try again.</Notice>
      ) : m ? (
        <div className={styles.meeting}>
          <span className={styles.tileLabel}>
            {fmtDay(m.date)}
            {m.startTime ? `, ${formatTimeOfDay(m.startTime)}` : ''}
            {m.location ? ` · ${m.location}` : ''}
          </span>
          <strong className={styles.meetingTitle}>{m.title}</strong>
          {canPlanner || canCalendar ? (
            <div className={styles.buttons}>
              {canPlanner ? (
                <Button variant="primary" size="sm" href="/planner/live">
                  Open Meeting Live
                </Button>
              ) : null}
              {canCalendar ? (
                <Button size="sm" href={`/admin/calendar/${m.entryId}?tab=roll-call`}>
                  Roll call
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className={styles.meeting}>
          <span className={styles.muted}>No troop meeting on the calendar yet.</span>
          {canCalendar ? (
            <div className={styles.buttons}>
              <Button size="sm" href="/admin/calendar">
                Open the Calendar
              </Button>
            </div>
          ) : null}
        </div>
      )}
      {week && week.comingUp.length > 0 ? (
        <div>
          <span className={styles.tileLabel}>Coming up</span>
          <ul className={styles.list}>
            {week.comingUp.map((c) => (
              <li key={c.id} className={styles.listRow}>
                {canCalendar ? <Link href={`/admin/calendar/${c.id}`}>{c.title}</Link> : <span>{c.title}</span>}
                <span className={styles.muted}>{fmtDay(c.date)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ShortcutsBlock({ items, canPin }: { items: Shortcut[]; canPin: boolean }) {
  return (
    <section aria-labelledby="home-shortcuts" className={styles.block}>
      <div className={styles.head}>
        <h2 id="home-shortcuts" className={styles.heading}>
          Your shortcuts
        </h2>
        {canPin ? (
          <span className={styles.muted}>
            Pinned first, then what you open most ·{' '}
            <Link href="/admin/pins" className={styles.headLink}>
              Edit pins
            </Link>
          </span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className={styles.muted}>
          {canPin
            ? 'Choose + Pin on any item in the menu, and it lands here. What you open most shows up here too.'
            : 'Shortcuts are kept per person. Sign in with your own email to get them.'}
        </p>
      ) : (
        <div className={styles.tiles}>
          {items.map((s) => (
            <Link key={s.key} href={s.href} className={styles.tile}>
              <span className={styles.tileName}>{s.label}</span>
              <span className={styles.tileSub}>
                {s.area} · {s.pinned ? 'pinned' : `opened ${plural(s.opens, 'time')} in 30 days`}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function ReportsShelf({ items, total }: { items: { key: string; label: string; href: string }[]; total: number }) {
  if (total === 0) return null;
  return (
    <section className={styles.card} aria-labelledby="home-reports">
      <div className={styles.head}>
        <h2 id="home-reports" className={styles.heading}>
          Reports
        </h2>
        <Link href="/admin/reports" className={styles.headLink}>
          All {total} reports →
        </Link>
      </div>
      <ul className={styles.shelf}>
        {items.map((r) => (
          <li key={r.key}>
            <Link href={r.href}>{r.label}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
