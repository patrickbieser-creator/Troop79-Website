'use client';

/**
 * The person record shell (Plans/Person-Editor-Rethink.md, Direction A):
 * header (name, kind + status pills, ids, primary contact), the fact strip,
 * then two columns — the Status card and the sections in the main column,
 * the Household / Sign-in / Where-they-appear cards at the side.
 *
 * Phase 1: every section other than Status is READ-ONLY — its Edit button is
 * greyed with "Coming in the next phase". The read renderers are the ones
 * later phases keep; only the forms are missing.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ageOn, gradeFromGradYear, gradeLabel, SWIM_CLASS_LABEL, yptStatus } from '@/lib/demographics';
import { fmtDate } from '@/lib/format-date';
import type { PersonEmailRow } from '@/lib/person-emails';
import { PageTitle } from '../../../_components/page-title';
import { Badge } from '../../../_components/badge';
import { Notice } from '../../../_components/notice';
import { Button } from '../../../../_components/button';
import { StatusCard, reasonLabel } from './status-card';
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

const REL_WORD: Record<string, string> = {
  parent_of: 'parent of',
  guardian_of: 'guardian of',
  sibling_of: 'sibling of',
  emergency_contact_for: 'emergency contact for'
};

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
    <>
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

          <ReadSection title="Details">
            <dl className={styles.dl}>
              <Row label="First name">{str(f.first_name)}</Row>
              <Row label="Last name">{str(f.last_name)}</Row>
              <Row label="Birthdate">
                {birthdate ? (
                  <>
                    {fmtDate(birthdate)} <span className={styles.sub}>age {age}</span>
                  </>
                ) : null}
              </Row>
              <Row label="BSA member ID">
                {str(f.bsa_member_id) ? <span className={styles.mono}>{str(f.bsa_member_id)}</span> : null}
              </Row>
              {kind === 'scout' ? (
                <>
                  <Row label="Patrol">{scout?.patrol ?? ''}</Row>
                  <Row label="Rank" derived>
                    {record.rankLabel ?? ''}
                  </Row>
                  <Row label="School">{scout?.school ?? ''}</Row>
                  <Row label="Grade" derived>
                    {scout?.graduation_year
                      ? `${gradeLabel(gradeFromGradYear(scout.graduation_year, record.today))} · class of ${scout.graduation_year}`
                      : ''}
                  </Row>
                  <Row label="Swim class">{scout?.swim_class ? SWIM_CLASS_LABEL[scout.swim_class] : ''}</Row>
                  <Row label="Junior leader">
                    {scout?.junior_leader_override === 'yes'
                      ? 'Yes (override)'
                      : scout?.junior_leader_override === 'no'
                        ? 'No (override)'
                        : 'Derived from grade'}
                  </Row>
                </>
              ) : (
                <Row label="YPT completed">
                  {str(f.ypt_completed) ? (
                    <>
                      {fmtDate(str(f.ypt_completed))}{' '}
                      <span className={styles.sub}>
                        {ypt.status === 'expired' ? 'EXPIRED' : ypt.status} · expires {fmtDate(ypt.expires)}
                      </span>
                    </>
                  ) : null}
                </Row>
              )}
              <Row label="Health form">{health ? fmtDate(health) : null}</Row>
              <Row label="Things we should know">{str(f.things_we_should_know)}</Row>
            </dl>
          </ReadSection>

          <ReadSection title="Contact & sign-in">
            <dl className={styles.dl}>
              <Row label="Phone">{phone ? <a href={`tel:${phone}`}>{phone}</a> : null}</Row>
              <Row label="Address">
                {[str(f.address_line1), str(f.address_line2), [str(f.city), str(f.state)].filter(Boolean).join(', ') + (str(f.zip) ? ` ${str(f.zip)}` : '')]
                  .filter((line) => line.trim())
                  .map((line, i) => (
                    <span key={i} className={i === 0 ? undefined : styles.sub}>
                      {line}
                    </span>
                  ))}
              </Row>
            </dl>
            <EmailList emails={emails} kind={kind} />
          </ReadSection>

          <ReadSection title="Household & family">
            <dl className={styles.dl}>
              <Row label="Household">{record.household?.label ?? ''}</Row>
            </dl>
            <div>
              <p className={styles.listHead}>{kind === 'scout' ? 'Parents & guardians' : 'Relationships'}</p>
              {detail.relationships.length ? (
                <ul className={styles.list}>
                  {detail.relationships.map((r) => (
                    <li key={r.id}>
                      <span className={styles.grow}>
                        {r.outgoing ? (
                          <>
                            <strong>{name}</strong> is {REL_WORD[r.type] ?? r.type} <strong>{r.otherName}</strong>
                          </>
                        ) : (
                          <>
                            <strong>{r.otherName}</strong> is {REL_WORD[r.type] ?? r.type} <strong>{name}</strong>
                          </>
                        )}
                      </span>
                      {r.isGuardian ? <Badge variant="info">guardian</Badge> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>
                  {kind === 'scout' ? 'No parents or guardians linked yet — this scout cannot sign in until one is.' : 'None recorded.'}
                </p>
              )}
            </div>
          </ReadSection>

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
    </>
  );
}

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

function Row({ label, derived = false, children }: { label: string; derived?: boolean; children: React.ReactNode }) {
  const empty = children == null || children === '' || (Array.isArray(children) && children.length === 0);
  return (
    <>
      <dt>
        {label}
        {derived ? <span className={styles.derived}> · derived</span> : null}
      </dt>
      <dd>{empty ? <span className={styles.empty}>—</span> : children}</dd>
    </>
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

function EmailList({ emails, kind }: { emails: PersonEmailRow[]; kind: string }) {
  return (
    <div>
      <p className={styles.listHead}>Email addresses</p>
      {emails.length ? (
        <ul className={styles.list}>
          {emails.map((e) => (
            <li key={e.id}>
              <span className={styles.grow}>
                {e.email} <span className={styles.muted}>{e.label}</span>
              </span>
              <span className={styles.pills}>
                {e.isPrimary ? <Badge variant="info">primary</Badge> : null}
                {e.verifiedAt ? (
                  <Badge variant="success" title={`Verified ${fmtDate(e.verifiedAt)}`}>
                    verified
                  </Badge>
                ) : (
                  <Badge variant="neutral">unverified</Badge>
                )}
                {e.bouncedAt ? (
                  <Badge variant="danger" title={`Bounced ${fmtDate(e.bouncedAt)}`}>
                    bounced
                  </Badge>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No addresses on file{kind === 'scout' ? ' — signs in through a parent' : ''}.</p>
      )}
    </div>
  );
}
