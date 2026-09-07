'use client';

/**
 * The Leaders / Adults roster grid. Since Phase 6 of Plans/Person-Editor-
 * Rethink.md (2026-09-07) this file is the TABLE only: a name is a link to
 * the person's record page (`roster/[personId]?from=<tab>`), where every
 * edit now happens. The PersonEditor dialog that used to live here — status,
 * demographics, emails, household, roles, relationships, merge / delete —
 * is retired; the record page's sections own each of those jobs. What stays
 * is the toolbar's "+ Add Adult" (adult-form.tsx), which is a create-once
 * dialog and not an editor.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROLE_LABEL } from './[personId]/record-types';
import { AdultForm } from './adult-form';
import { AddButton } from '../../_components/add-button';
import { Badge } from '../../_components/badge';
import { SortHeader, useSortable } from '../../_components/use-sortable';
import styles from './roster.module.css';

export interface DirectoryPerson {
  person_id: number;
  display_name: string;
  primary_email: string | null;
  primary_phone: string | null;
  bsa_member_id: string | null;
  scout_id: string | null;
  inactive_reason: string | null;
  roles: string;
  tab: 'active_scout' | 'inactive_scout' | 'leader' | 'adult';
  in_picker: boolean;
  active: boolean;
  person_inactive_reason: string | null;
}

export interface HouseholdOption {
  id: number;
  label: string;
}

type PeopleColKey = 'name' | 'email' | 'phone' | 'bsa';

/** Module scope on purpose — see the note on useSortable. */
function personValue(p: DirectoryPerson, key: PeopleColKey): unknown {
  switch (key) {
    case 'name':
      return p.display_name;
    case 'email':
      return p.primary_email;
    case 'phone':
      return p.primary_phone;
    case 'bsa':
      return p.bsa_member_id;
  }
}

/** Where a row's name goes: the record page, remembering which tab it came
 *  from so the page's Back link returns here. */
export function personRecordHref(p: Pick<DirectoryPerson, 'person_id' | 'tab'>): string {
  return `/admin/advancement/roster/${p.person_id}?from=${p.tab}`;
}

export function PeopleTable({
  people,
  households,
  householdByPerson,
  householdMembers
}: {
  people: DirectoryPerson[];
  households: HouseholdOption[];
  householdByPerson: Record<number, number>;
  householdMembers: Record<number, string[]>;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  // null initial key: the server's display_name order IS the default; sorting
  // starts only when a header is clicked.
  // The name search moved above the tabs (RosterSearch, 2026-08-27).
  const { sorted, sortKey, sortDir, toggle } = useSortable<DirectoryPerson, PeopleColKey>(
    people,
    personValue,
    null
  );

  return (
    <div>
      <div className={styles.tableToolbar}>
        <span className={styles.toolbarSpacer} />
        {/* The front door adults never had — same toolbar position as the
            Scouts tab's "+ Add Scout". */}
        <AddButton onClick={() => setAdding(true)}>+ Add Adult</AddButton>
      </div>

      {adding && (
        <AdultForm
          households={households}
          onClose={() => setAdding(false)}
          onCreated={() => router.refresh()}
        />
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <SortHeader label="Name" colKey="name" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
            <SortHeader label="Email" colKey="email" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
            <SortHeader label="Phone" colKey="phone" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
            <th>Roles</th>
            <th>Household</th>
            <SortHeader label="BSA ID" colKey="bsa" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
            {/* Status is the LAST column on every roster grid (Patrick, 2026-08-27). */}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const hh = householdByPerson[p.person_id];
            return (
              <tr key={p.person_id}>
                <td>
                  {/* Same bare name trigger and status Badge as the Scouts tab
                      (Jenna's roster alignment, 2026-08-27) — now a link to
                      the record page rather than a dialog trigger. */}
                  <Link href={personRecordHref(p)} className={styles.nameBtn} title="Open this person's record">
                    {p.display_name}
                  </Link>
                </td>
                <td>{p.primary_email || <span className={styles.muted}>—</span>}</td>
                <td>{p.primary_phone || <span className={styles.muted}>—</span>}</td>
                <td>
                  {p.roles
                    ? p.roles
                        .split(', ')
                        .map((r) => ROLE_LABEL[r] ?? r)
                        .join(', ')
                    : <span className={styles.muted}>none</span>}
                </td>
                <td>
                  {/* "Vest (4)" — the member count in parentheses keeps the row to
                      one line (Patrick, 2026-08-27). */}
                  {hh ? (
                    `${households.find((h) => h.id === hh)?.label ?? ''} (${(householdMembers[hh] ?? []).length})`
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td className={styles.mono}>{p.bsa_member_id || <span className={styles.muted}>—</span>}</td>
                <td>
                  {p.active ? (
                    <Badge variant="success" title="Offered in the family signup picker">
                      Active
                    </Badge>
                  ) : (
                    <Badge
                      variant="danger"
                      title={
                        p.person_inactive_reason
                          ? `Not offered at signup — ${p.person_inactive_reason}`
                          : 'Not offered at signup; still on record'
                      }
                    >
                      Inactive
                    </Badge>
                  )}
                </td>
                {/* The trailing duplicate Edit button is gone (Section 2
                    stretched-link sweep, 2026-08-21) — the name is the single
                    way into the record, matching ScoutsTable. */}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
