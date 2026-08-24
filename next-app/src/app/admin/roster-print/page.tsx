import type { Metadata } from 'next';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { loadRosterPrintData } from '@/lib/roster-print-data';
import {
  buildFamilyRoster,
  buildLeaderDirectory,
  buildPatrolRoster,
  rosterCounts
} from '@/lib/roster-print';
import { loadSeoSettings, resolveSeo } from '@/lib/seo';
import { PrintToolbar } from './print-toolbar';
import '../(workspace)/admin.css';
import styles from './roster-print.module.css';

import { fmtDateLong } from '@/lib/format-date';
/**
 * The home roster — "a better, more useful printout of the roster that could
 * be in PDF format that would be available for leaders to keep by their phones
 * at home" (Patrick, 2026-08-22).
 *
 * OUTSIDE the (workspace) route group on purpose, the same way /admin/login
 * is: there is no chrome to hide because the page IS the document. That also
 * means this file, not the workspace layout, is where access is decided —
 * hence the requireCapability call below.
 *
 * WHY NOT A PDF LIBRARY. "Save as PDF" is a button in every browser's print
 * dialog, on desktop and on a phone. A server-side PDF renderer would add a
 * heavy dependency, a second layout engine to keep in sync with this CSS, and
 * a font-embedding problem — to produce the same file the browser already
 * makes. The @page rules in roster-print.module.css do the work.
 *
 * WHAT IS ON IT, and why (Patrick asked "what are the things that would be
 * useful for a home roster?"):
 *   1. FAMILIES — surname, address, each scout with patrol/rank/grade, each
 *      parent with the family word, phone and email. Grouped by household
 *      because the question is "who is Ben's mom and what's her cell".
 *   2. WHO TO CALL — adults holding a troop role, Scoutmaster and Committee
 *      Chair first.
 *   3. PATROLS — who is in which patrol, for the scout who needs to reach
 *      their patrol and for the leader taking attendance.
 *   4. TROOP FACTS — where and when the troop meets, the website, the
 *      calendar feed. The things someone new asks in the first month.
 *
 * NOT on it: anything medical (the 2026-07-13 decision, and this sheet leaves
 * the building), BSA member IDs, and birthdates. See lib/roster-print.ts.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Troop 79 Family Roster',
  // Belt and braces. The page is capability-gated, but a roster of every
  // family's address should carry its own instruction not to be indexed.
  robots: { index: false, follow: false }
};

const formatLongDate = (iso: string): string => fmtDateLong(iso);

export default async function RosterPrintPage() {
  await requireCapability('roster.manage');

  const [data, settings] = await Promise.all([
    loadRosterPrintData(),
    loadSeoSettings(createAdminClient())
  ]);

  const families = buildFamilyRoster(data);
  const leaders = buildLeaderDirectory(data);
  const patrols = buildPatrolRoster(data);
  const counts = rosterCounts(data);
  const meetingPlace = resolveSeo(settings, 'seo.meeting_place');

  return (
    <div className={styles.doc}>
      <PrintToolbar />

      <header className={styles.cover}>
        <h1 className={styles.coverTitle}>Troop 79 Family Roster</h1>
        <p className={styles.coverSub}>Scouts BSA Troop 79 &middot; Milwaukee, Wisconsin</p>
        <div className={styles.coverMeta}>
          <span>{counts.families} families</span>
          <span>{counts.scouts} scouts</span>
          <span>{counts.adults} registered adults</span>
          <span>Printed {formatLongDate(data.generatedOn)}</span>
        </div>
      </header>

      <p className={styles.confidential}>
        For Troop 79 families only. This sheet lists home addresses, phone numbers and email
        addresses. Do not post it, forward it, or share it outside the troop. If it is out of
        date, print a fresh one rather than correcting this copy &mdash; the roster changes.
      </p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Families</h2>
        <div className={styles.families}>
          {families.map((f) => (
            <div key={f.key} className={styles.family}>
              <h3 className={styles.familyName}>{f.label}</h3>
              {f.address && <p className={styles.familyAddress}>{f.address}</p>}
              <ul className={styles.people}>
                {f.scouts.map((s) => (
                  <li key={s.id} className={styles.person}>
                    <span className={styles.personName}>{s.name}</span>
                    <span className={`${styles.personTag} ${styles.scoutTag}`}>
                      {[s.patrol, s.rank, s.grade].filter(Boolean).join(' · ') || 'Scout'}
                    </span>
                    {(s.phone || s.email) && (
                      <span className={styles.personDetail}>
                        {[s.phone, s.email].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    {s.address && <span className={styles.personDetail}>{s.address}</span>}
                  </li>
                ))}
                {f.adults.map((a) => (
                  <li key={a.name} className={styles.person}>
                    <span className={styles.personName}>{a.name}</span>
                    {a.relationship && <span className={styles.personTag}>{a.relationship}</span>}
                    {a.role && <span className={`${styles.personTag} ${styles.roleTag}`}>{a.role}</span>}
                    {(a.phone || a.email) && (
                      <span className={styles.personDetail}>
                        {[a.phone, a.email].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    {a.address && <span className={styles.personDetail}>{a.address}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Who to call</h2>
        <div className={styles.cols}>
          {leaders.map((l) => (
            <div key={`${l.name}-${l.role}`} className={styles.block}>
              <p className={styles.blockTitle}>{l.role}</p>
              <ul className={styles.plainList}>
                <li>{l.name}</li>
                {l.phone && <li>{l.phone}</li>}
                {l.email && <li className={styles.muted}>{l.email}</li>}
                {!l.phone && !l.email && <li className={styles.muted}>no contact on file</li>}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Patrols</h2>
        <div className={styles.cols}>
          {patrols.map((p) => (
            <div key={p.name} className={styles.block}>
              <p className={styles.blockTitle}>
                {p.name} <span className={styles.muted}>({p.scouts.length})</span>
              </p>
              <ul className={styles.plainList}>
                {p.scouts.map((s) => (
                  <li key={s.id}>
                    {s.name}
                    {s.rank && <span className={styles.muted}> &middot; {s.rank}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>The troop</h2>
        <div className={styles.cols}>
          <div className={styles.block}>
            <p className={styles.blockTitle}>Where we meet</p>
            <ul className={styles.plainList}>
              <li>{meetingPlace || 'Set the meeting location under Lookups & Admin → Search & AI visibility.'}</li>
            </ul>
          </div>
          <div className={styles.block}>
            <p className={styles.blockTitle}>Online</p>
            <ul className={styles.plainList}>
              <li>www.troop-79.com</li>
              <li className={styles.muted}>Calendar, news, advancement and sign-ups</li>
              <li>www.troop-79.com/calendar.ics</li>
              <li className={styles.muted}>Subscribe to the troop calendar on your phone</li>
            </ul>
          </div>
        </div>
        <p className={styles.footNote}>
          Something wrong on this sheet? Families can correct their own details on the troop site
          under Profile; anything else, tell a leader and it will be fixed at the source so the
          next printing is right.
        </p>
      </section>
    </div>
  );
}
