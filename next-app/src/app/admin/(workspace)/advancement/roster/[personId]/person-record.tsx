'use client';

/**
 * The person record shell (Plans/Person-Editor-Rethink.md, Direction A):
 * header (name, kind + status pills, ids, primary contact, Send sign-in
 * link), the fact strip, then two columns — the Status card and the
 * sections in the main column, the Household / Sign-in / Where-they-appear
 * cards at the side.
 *
 * Phase 2 made the sections real: Identity (scouts), Details, Contact &
 * sign-in and Household & family each own a per-section Edit → Save/Cancel
 * form (section-card.tsx), one editable at a time under SectionEditProvider.
 * Phase 3 added what commits on click: the "Takes effect immediately" blocks
 * (emails inside Contact, relationships inside Family, Roles as its own
 * section), the collapsed Danger zone (merge / delete / promote) and the
 * header's Send sign-in link. The shell keeps the LIVE copies of emails,
 * roles, relationships and the adult's roster tab: a block refetches after
 * its action and hands the fresh rows up here, so the header, facts, side
 * cards and the "now appears under …" notice follow without a round trip;
 * router.refresh() then re-renders the server's view underneath.
 * Phase 4 added History: a fact-strip card and a section above the Danger
 * zone, rendered straight from the server's `record.history` (the
 * audit_log filtered to this person), so that same router.refresh() after
 * any action is what brings the new row in; the full-log / detail dialog is
 * owned here because both the card and the section open it.
 * Phase 5 put the family's pending update INSIDE the sections it touches
 * (pending-banner.tsx): the shell hands each section the banner for its own
 * fields; Approve / Reject from any one of them decides the whole request,
 * after which the shell drops it everywhere at once. The "Added by a family"
 * notice sits at the top of the main column with its single Acknowledge.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ageOn, gradeFromGradYear, gradeLabel, yptStatus } from '@/lib/demographics';
import { fmtDate } from '@/lib/format-date';
import type { PersonEmailRow } from '@/lib/person-emails';
import { PageTitle } from '../../../_components/page-title';
import { Badge } from '../../../_components/badge';
import { Notice } from '../../../_components/notice';
import type { PersonDetail } from '../person-actions';
import { StatusCard, reasonLabel } from './status-card';
import { SectionEditProvider } from './section-card';
import { IdentitySection } from './identity-section';
import { AdultDetailsSection, ScoutDetailsSection, gradeFor } from './details-section';
import { ContactSection } from './contact-section';
import { FamilySection } from './family-section';
import { RolesBlock } from './roles-block';
import { DangerZone } from './danger-zone';
import { HistoryFact } from './history-card';
import { HistorySection } from './history-section';
import { HistoryDialog, type HistoryView } from './history-dialog';
import { SendSignInLink, type SendLinkResult } from './send-sign-in-link';
import { FamilyAddedNotice, PendingBanner } from './pending-banner';
import { currentValuesFor, type SectionKey } from './pending-map';
import {
  ROLE_LABEL,
  TAB_LABEL,
  isRosterTab,
  type PersonHistoryEntry,
  type PersonHistorySummary,
  type PersonRecord as PersonRecordData,
  type PersonStatus,
  type RosterTab
} from './record-types';
import styles from './person-record.module.css';

const ROSTER = '/admin/advancement/roster';

const KIND_LABEL = { scout: 'Scout', leader: 'Leader', adult: 'Adult' } as const;

const NO_HISTORY: PersonHistorySummary = { latest: [], total: 0, withDetails: 0 };

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

export function PersonRecord({ record, from }: { record: PersonRecordData; from: RosterTab }) {
  const router = useRouter();
  const [status, setStatus] = useState<PersonStatus>(record.status);
  const [emails, setEmails] = useState<PersonEmailRow[]>(record.emails);
  const [roles, setRoles] = useState<PersonDetail['roles']>(record.detail.roles);
  const [relationships, setRelationships] = useState<PersonDetail['relationships']>(record.detail.relationships);
  const [adultTab, setAdultTab] = useState<RosterTab>(record.tab);
  const [linkResult, setLinkResult] = useState<SendLinkResult | null>(null);
  const [signinHelp, setSigninHelp] = useState(false);
  const [historyView, setHistoryView] = useState<HistoryView | null>(null);
  // The family's request / notice come from the server; once decided here
  // they are gone from every section at once, and a later router.refresh()
  // (a new request while the page is open) shows the next one.
  const [resolvedRequestId, setResolvedRequestId] = useState<number | null>(null);
  const [resolvedNoticeId, setResolvedNoticeId] = useState<number | null>(null);
  const pending = record.pending && record.pending.id !== resolvedRequestId ? record.pending : null;
  const familyNotice = record.familyNotice && record.familyNotice.id !== resolvedNoticeId ? record.familyNotice : null;

  const { detail, scout, kind } = record;
  const f = detail.fields;
  const name = record.displayName;
  const primary = emails.find((e) => e.isPrimary) ?? null;
  const deliverable = emails.filter((e) => !e.bouncedAt);
  const phone = str(f.primary_phone);
  const birthdate = str(f.birthdate) || null;
  const age = ageOn(birthdate, record.today);
  const health = str(f.health_form_date) || null;
  const ypt = yptStatus(str(f.ypt_completed) || null, record.today);
  const currentRoles = roles.filter((r) => !r.end_date);
  const parents = relationships.filter((r) => !r.outgoing && (r.type === 'parent_of' || r.type === 'guardian_of'));

  // A scout's tab follows the status it just changed; an adult's follows the
  // roles, refetched after every grant / end.
  const currentTab: RosterTab = kind === 'scout' ? (status.active ? 'active_scout' : 'inactive_scout') : adultTab;

  function onStatusChanged(next: PersonStatus) {
    setStatus(next);
    router.refresh();
  }

  /** A block refetched getPersonDetail after its action. */
  function onDetail(next: PersonDetail) {
    setRoles(next.roles);
    setRelationships(next.relationships);
    if (kind !== 'scout') setAdultTab(isRosterTab(next.tab) ? next.tab : 'adult');
  }

  function onPromoted() {
    setStatus({ active: false, reason: 'aged_out' });
  }

  // One request, one decision: whichever section's button was clicked, the
  // whole request is now reviewed — drop it from every section and re-read
  // so the applied values and the History row come in.
  const pendingCurrent = pending ? currentValuesFor(record, pending.entityType) : null;
  function bannerFor(section: SectionKey) {
    if (!pending || !pendingCurrent) return null;
    return (
      <PendingBanner
        request={pending}
        section={section}
        current={pendingCurrent}
        today={record.today}
        onResolved={() => {
          setResolvedRequestId(pending.id);
          router.refresh();
        }}
      />
    );
  }

  function onAcknowledged() {
    if (familyNotice) setResolvedNoticeId(familyNotice.id);
    router.refresh();
  }

  // A sent link is itself a History row — re-read so the card's count moves.
  function onLinkResult(result: SendLinkResult) {
    setLinkResult(result);
    if (result.variant === 'success') router.refresh();
  }

  const history = record.history ?? NO_HISTORY;
  const openLog = () => setHistoryView({ mode: 'log' });
  const openDetail = (entry: PersonHistoryEntry) => setHistoryView({ mode: 'detail', entry, fromLog: false });
  const historyFact: [string, React.ReactNode] = ['History', <HistoryFact key="history" history={history} onOpen={openLog} />];

  const facts: [string, React.ReactNode][] =
    kind === 'scout'
      ? [
          ['Rank', record.rankLabel ?? '—'],
          ['Patrol', scout?.patrol || '—'],
          ['Grade', gradeLabel(gradeFromGradYear(scout?.graduation_year ?? null, record.today))],
          ['Age', age ?? '—'],
          ['Health form', health ? fmtDate(health) : <Badge variant="warning">missing</Badge>],
          historyFact
        ]
      : [
          ['Household', record.household?.label ?? '—'],
          ['Roles', currentRoles.map((r) => ROLE_LABEL[r.role] ?? r.role).join(', ') || 'none'],
          ['Age', age ?? '—'],
          [
            'YPT',
            ypt.status === 'missing' ? (
              <Badge variant="warning">none</Badge>
            ) : ypt.status === 'expired' ? (
              <Badge variant="danger">expired</Badge>
            ) : ypt.status === 'expiring' ? (
              <Badge variant="warning">expiring</Badge>
            ) : (
              <Badge variant="success">current</Badge>
            )
          ],
          ['Health form', health ? fmtDate(health) : <Badge variant="warning">missing</Badge>],
          historyFact
        ];

  return (
    <SectionEditProvider>
      <PageTitle
        back={{ label: TAB_LABEL[from], href: `${ROSTER}?tab=${from}` }}
        title={name}
        sub={
          <>
            <span className={styles.pills}>
              <Badge variant={kind === 'adult' ? 'neutral' : 'info'}>{KIND_LABEL[kind]}</Badge>
              {status.active ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <>
                  <Badge variant="muted">Inactive</Badge>
                  <span className={styles.muted}>{reasonLabel(kind, status.reason) ?? ''}</span>
                </>
              )}
              {kind === 'scout' && scout ? <span className={styles.mono}>{scout.id}</span> : null}
              {str(f.bsa_member_id) ? <span className={styles.mono}>BSA {str(f.bsa_member_id)}</span> : null}
            </span>
            <span className={styles.contact}>
              {primary ? (
                <a href={`mailto:${primary.email}`}>{primary.email}</a>
              ) : kind === 'scout' ? (
                `signs in through ${parents.length ? parents.map((p) => p.otherName).join(' or ') : 'a parent (none linked)'}`
              ) : (
                <span className={styles.muted}>no email on file</span>
              )}
              {phone ? (
                <>
                  {' · '}
                  <a href={`tel:${phone}`}>{phone}</a>
                </>
              ) : null}
            </span>
          </>
        }
      >
        <SendSignInLink personId={record.personId} kind={kind} emails={emails} onResult={onLinkResult} />
      </PageTitle>

      {(currentTab !== from || linkResult) && (
        <div className={styles.noticeStack}>
          {linkResult && <Notice variant={linkResult.variant}>{linkResult.message}</Notice>}
          {currentTab !== from && (
            <Notice variant="info">
              {name} now appears under <strong>{TAB_LABEL[currentTab]}</strong>, not {TAB_LABEL[from]}.
            </Notice>
          )}
        </div>
      )}

      <dl className={styles.facts}>
        {facts.map(([k, v]) => (
          <div key={k} className={styles.fact}>
            <dt className={styles.factKey}>{k}</dt>
            <dd className={styles.factVal}>{v}</dd>
          </div>
        ))}
      </dl>

      <div className={styles.cols}>
        <div className={styles.main}>
          {familyNotice && <FamilyAddedNotice notice={familyNotice} name={name} onAcknowledged={onAcknowledged} />}

          <StatusCard
            personId={record.personId}
            scoutId={kind === 'scout' ? (scout?.id ?? null) : null}
            kind={kind}
            name={name}
            active={record.status.active}
            reason={record.status.reason}
            onChanged={onStatusChanged}
          />

          {kind === 'scout' && scout ? (
            <>
              <IdentitySection
                scoutId={scout.id}
                banner={bannerFor('identity')}
                saved={{
                  first_name: str(f.first_name),
                  last_name: str(f.last_name),
                  bsa_member_id: str(f.bsa_member_id),
                  patrol: scout.patrol ?? ''
                }}
                rankLabel={record.rankLabel}
              />
              <ScoutDetailsSection
                personId={record.personId}
                banner={bannerFor('details')}
                scoutId={scout.id}
                today={record.today}
                saved={{
                  birthdate: str(f.birthdate),
                  gender: record.gender ?? '',
                  school: scout.school ?? '',
                  grade: gradeFor(scout.graduation_year, record.today),
                  swim_class: scout.swim_class ?? '',
                  junior_leader_override: scout.junior_leader_override ?? '',
                  health_form_date: str(f.health_form_date),
                  things_we_should_know: str(f.things_we_should_know)
                }}
              />
            </>
          ) : (
            <AdultDetailsSection
              personId={record.personId}
              banner={bannerFor('details')}
              today={record.today}
              saved={{
                first_name: str(f.first_name),
                last_name: str(f.last_name),
                birthdate: str(f.birthdate),
                bsa_member_id: str(f.bsa_member_id),
                ypt_completed: str(f.ypt_completed),
                health_form_date: str(f.health_form_date),
                things_we_should_know: str(f.things_we_should_know)
              }}
            />
          )}

          <ContactSection
            personId={record.personId}
            banner={bannerFor('contact')}
            kind={kind}
            emails={emails}
            onEmailsChanged={setEmails}
            saved={{
              primary_phone: str(f.primary_phone),
              address_line1: str(f.address_line1),
              address_line2: str(f.address_line2),
              city: str(f.city),
              state: str(f.state),
              zip: str(f.zip)
            }}
          />

          <FamilySection
            personId={record.personId}
            banner={bannerFor('family')}
            name={name}
            kind={kind}
            saved={{ household: record.household ? String(record.household.id) : '' }}
            households={record.households}
            relationships={relationships}
            onRelationshipsChanged={onDetail}
          />

          {kind !== 'scout' && (
            <section className={styles.card} aria-label="Roles">
              <div className={styles.cardHead}>
                <h2>Roles</h2>
              </div>
              <div className={styles.cardBody}>
                <RolesBlock personId={record.personId} name={name} roles={roles} today={record.today} onChanged={onDetail} />
              </div>
            </section>
          )}

          <HistorySection history={history} onOpenLog={openLog} onOpenDetail={openDetail} />

          <DangerZone
            personId={record.personId}
            name={name}
            kind={kind}
            from={from}
            active={status.active}
            scout={scout}
            leader={record.leader}
            emailCount={emails.length}
            relationshipCount={relationships.length}
            roleCount={roles.length}
            householdLabel={record.household?.label ?? null}
            onPromoted={onPromoted}
          />
        </div>

        <aside className={styles.side}>
          <SideCard title="Household">
            {record.household ? (
              <>
                <strong>{record.household.label}</strong>
                <ul className={styles.list}>
                  {record.household.members.map((m) => (
                    <li key={m.personId}>
                      <span className={styles.grow}>
                        {m.personId === record.personId ? (
                          <strong>{m.name}</strong>
                        ) : (
                          <Link href={`${ROSTER}/${m.personId}?from=${from}`}>{m.name}</Link>
                        )}
                      </span>
                      <span className={styles.muted}>
                        {KIND_LABEL[m.kind]}
                        {m.active ? '' : ' · inactive'}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <span className={styles.empty}>Not in a household</span>
            )}
          </SideCard>

          <SideCard title="Sign-in">
            <ul className={styles.list}>
              <li>
                <span title="Derived from the addresses on file — not a switch">Can sign in</span>
                <span>
                  {deliverable.length ? 'Yes' : kind === 'scout' ? 'Via a parent' : <Badge variant="warning">no email</Badge>}
                </span>
              </li>
              <li>
                <span>Verified addresses</span>
                <span>
                  {emails.filter((e) => e.verifiedAt).length} of {emails.length}
                </span>
              </li>
              {kind === 'leader' && (
                <li>
                  <span>Admin access</span>
                  <span>
                    {record.leader?.canLogin ? 'Yes' : 'No'}{' '}
                    <span className={styles.muted}>
                      · <Link href="/admin/access">Access &amp; Permissions</Link>
                    </span>
                  </span>
                </li>
              )}
            </ul>
            <div>
              <button
                type="button"
                className={styles.disc}
                aria-expanded={signinHelp}
                onClick={() => setSigninHelp((h) => !h)}
              >
                How this works
              </button>
              {signinHelp && (
                <div className={styles.discBody}>
                  <p>
                    <strong>Can sign in</strong> is derived, not a setting: anyone with an address on file that has not
                    bounced can ask for a sign-in code or link at /signin. A scout with no address of their own signs in
                    as one of the household&rsquo;s parents. Add or remove addresses under Contact &amp; sign-in.
                  </p>
                  <p>
                    <strong>Verified</strong> is stamped automatically the first time a code or link sent to that
                    address is redeemed — proof someone reads that inbox. There is no manual verify; sending a sign-in
                    link from here is how a leader gets an address verified.
                  </p>
                  <p>
                    <strong>Admin access</strong> (leaders only) is a separate flag managed on the Access &amp;
                    Permissions screen, not here.
                  </p>
                </div>
              )}
            </div>
          </SideCard>

          <SideCard title="Where they appear">
            <ul className={styles.list}>
              <li>
                <span>Roster tab</span>
                <span>{TAB_LABEL[currentTab]}</span>
              </li>
              <li>
                <span>Signup picker</span>
                <span>{status.active ? 'Offered' : 'Not offered'}</span>
              </li>
              {kind === 'scout' && (
                <li>
                  <span>Fast Entry</span>
                  <span>{status.active ? 'Listed' : 'Hidden'}</span>
                </li>
              )}
              <li>
                <span>Record</span>
                <span className={styles.mono}>people #{record.personId}</span>
              </li>
            </ul>
          </SideCard>
        </aside>
      </div>

      {historyView && (
        <HistoryDialog
          personId={record.personId}
          name={name}
          view={historyView}
          onView={setHistoryView}
          onClose={() => setHistoryView(null)}
        />
      )}
    </SectionEditProvider>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.card} aria-label={title}>
      <div className={styles.cardHead}>
        <h2>{title}</h2>
      </div>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}
