'use client';

/**
 * The person record shell (Plans/Person-Editor-Rethink.md, Direction A):
 * header (name, kind + status pills, ids, primary contact), the fact strip,
 * then two columns — the Status card and the sections in the main column,
 * the Household / Sign-in / Where-they-appear cards at the side.
 *
 * Phase 2: the sections are real. Identity (scouts), Details, Contact &
 * sign-in and Household & family each own a per-section Edit → Save/Cancel
 * form (section-card.tsx), one editable at a time under SectionEditProvider.
 * Emails and relationships are still read-only lists inside their sections
 * and Roles keeps its greyed Edit — Phase 3 makes those the "Takes effect
 * immediately" blocks. Every successful save calls router.refresh() so the
 * header, fact strip and side cards re-render from the server's data.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ageOn, gradeFromGradYear, gradeLabel, yptStatus } from '@/lib/demographics';
import { fmtDate } from '@/lib/format-date';
import { PageTitle } from '../../../_components/page-title';
import { Badge } from '../../../_components/badge';
import { Notice } from '../../../_components/notice';
import { Button } from '../../../../_components/button';
import { StatusCard, reasonLabel } from './status-card';
import { SectionEditProvider } from './section-card';
import { IdentitySection } from './identity-section';
import { AdultDetailsSection, ScoutDetailsSection, gradeFor } from './details-section';
import { ContactSection } from './contact-section';
import { FamilySection } from './family-section';
import { TAB_LABEL, type PersonRecord as PersonRecordData, type PersonStatus, type RosterTab } from './record-types';
import styles from './person-record.module.css';

const ROSTER = '/admin/advancement/roster';

// The roster editor's private map — consolidated in Phase 6 when it retires.
const ROLE_LABEL: Record<string, string> = {
  adult_leader: 'Adult leader',
  committee_member: 'Committee member',
  chartered_org_rep: 'Chartered org rep',
  merit_badge_counselor: 'Merit badge counselor',
  external_contact: 'External contact',
  youth_member: 'Youth member'
};
const LEADER_ROLES = new Set(['adult_leader', 'committee_member', 'chartered_org_rep']);

const KIND_LABEL = { scout: 'Scout', leader: 'Leader', adult: 'Adult' } as const;

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

export function PersonRecord({ record, from }: { record: PersonRecordData; from: RosterTab }) {
  const router = useRouter();
  const [status, setStatus] = useState<PersonStatus>(record.status);
  const [signinHelp, setSigninHelp] = useState(false);

  const { detail, emails, scout, kind } = record;
  const f = detail.fields;
  const name = record.displayName;
  const primary = emails.find((e) => e.isPrimary) ?? null;
  const deliverable = emails.filter((e) => !e.bouncedAt);
  const phone = str(f.primary_phone);
  const birthdate = str(f.birthdate) || null;
  const age = ageOn(birthdate, record.today);
  const health = str(f.health_form_date) || null;
  const ypt = yptStatus(str(f.ypt_completed) || null, record.today);
  const currentRoles = detail.roles.filter((r) => !r.end_date);
  const endedRoles = detail.roles.filter((r) => r.end_date);
  const parents = detail.relationships.filter((r) => !r.outgoing && (r.type === 'parent_of' || r.type === 'guardian_of'));

  // A scout's tab follows the status it just changed; an adult's follows roles.
  const currentTab: RosterTab = kind === 'scout' ? (status.active ? 'active_scout' : 'inactive_scout') : record.tab;

  function onStatusChanged(next: PersonStatus) {
    setStatus(next);
    router.refresh();
  }

  const facts: [string, React.ReactNode][] =
    kind === 'scout'
      ? [
          ['Rank', record.rankLabel ?? '—'],
          ['Patrol', scout?.patrol || '—'],
          ['Grade', gradeLabel(gradeFromGradYear(scout?.graduation_year ?? null, record.today))],
          ['Age', age ?? '—'],
          ['Health form', health ? fmtDate(health) : <Badge variant="warning">missing</Badge>]
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
          ['Health form', health ? fmtDate(health) : <Badge variant="warning">missing</Badge>]
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
      />

      {(record.pendingUpdate || currentTab !== from) && (
        <div className={styles.noticeStack}>
          {record.pendingUpdate && (
            <Notice variant="info">
              A pending update from the family is waiting for review. Until the next phase, open {name} from the{' '}
              <Link href={`${ROSTER}?tab=${record.tab}`}>roster list</Link> to approve or reject it.
            </Notice>
          )}
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
            kind={kind}
            emails={emails}
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
            name={name}
            kind={kind}
            saved={{ household: record.household ? String(record.household.id) : '' }}
            households={record.households}
            relationships={detail.relationships}
          />

          {kind !== 'scout' && (
            <ReadSection title="Roles">
              <div>
                <p className={styles.listHead}>Current roles</p>
                {currentRoles.length ? (
                  <ul className={styles.list}>
                    {currentRoles.map((r) => (
                      <li key={r.id}>
                        <span className={styles.grow}>
                          {ROLE_LABEL[r.role] ?? r.role}{' '}
                          <span className={styles.muted}>since {fmtDate(r.start_date)}</span>
                        </span>
                        {LEADER_ROLES.has(r.role) ? <Badge variant="info">leader tab</Badge> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.empty}>No current role — listed under Adults.</p>
                )}
              </div>
              {endedRoles.length > 0 && (
                <div>
                  <p className={styles.listHead}>Previously held</p>
                  <ul className={styles.list}>
                    {endedRoles.map((r) => (
                      <li key={r.id}>
                        <span className={`${styles.grow} ${styles.muted}`}>
                          {ROLE_LABEL[r.role] ?? r.role} · {fmtDate(r.start_date)} – {fmtDate(r.end_date)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </ReadSection>
          )}
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
                    as one of the household&rsquo;s parents.
                  </p>
                  <p>
                    <strong>Verified</strong> is stamped automatically the first time a code or link sent to that
                    address is redeemed. There is no manual verify; sending a sign-in link from the roster is how a
                    leader gets an address verified.
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
    </SectionEditProvider>
  );
}

/** Roles stays read-only until Phase 3's immediate block. */
function ReadSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.card} aria-label={title}>
      <div className={styles.cardHead}>
        <h2>{title}</h2>
        <Button size="sm" disabled title="Coming in the next phase" aria-disabled="true">
          Edit
        </Button>
      </div>
      <div className={styles.cardBody}>{children}</div>
    </section>
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
