/**
 * A household on /profile with NO controls — the superuser proxy's view
 * (Patrick, 2026-10-13; lib/member-viewer.ts). Deliberately its own plain
 * component rather than HouseholdMembers with the editors switched off: the
 * editors carry the server-action forms, and "no form is rendered" is a
 * stronger guarantee than "the forms are disabled". Pure presentation —
 * the page loads the data and shapes it with scoutRows()/adultRows().
 */
import { fmtDate } from '@/lib/format-date';
import type { ScoutProfileFields } from './profile-editor';
import type { AdultProfileFields } from './adult-editor';
import styles from './profile.module.css';

export interface ReadOnlyMember {
  key: string;
  name: string;
  /** "Scout", or the adult's relationship when one is recorded. */
  role: string;
  rows: { label: string; value: string }[];
}

const SWIM_LABEL: Record<string, string> = {
  swimmer: 'Swimmer',
  beginner: 'Beginner',
  nonswimmer: 'Non-swimmer'
};

function address(f: {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): string {
  const cityLine = [[f.city, f.state].filter(Boolean).join(', '), f.zip].filter(Boolean).join(' ');
  return [f.address_line1, f.address_line2, cityLine].filter(Boolean).join(', ');
}

function present(rows: { label: string; value: string | null | undefined }[]): { label: string; value: string }[] {
  return rows.filter((r): r is { label: string; value: string } => !!r.value);
}

export function scoutRows(f: ScoutProfileFields): { label: string; value: string }[] {
  return present([
    { label: 'Address', value: address(f) },
    { label: 'Phone', value: f.phone },
    { label: 'Email', value: f.email },
    { label: 'Birthdate', value: f.birthdate ? fmtDate(f.birthdate) : null },
    { label: 'School', value: f.school },
    { label: 'Graduation year', value: f.graduation_year != null ? String(f.graduation_year) : null },
    { label: 'Swim classification', value: f.swim_class ? (SWIM_LABEL[f.swim_class] ?? f.swim_class) : null },
    { label: 'Things we should know', value: f.things_we_should_know }
  ]);
}

export function adultRows(f: AdultProfileFields): { label: string; value: string }[] {
  return present([
    { label: 'Address', value: address(f) },
    { label: 'Phone', value: f.primary_phone },
    { label: 'Email', value: f.primary_email },
    { label: 'Birthdate', value: f.birthdate ? fmtDate(f.birthdate) : null }
  ]);
}

export function HouseholdReadOnly({ members }: { members: ReadOnlyMember[] }) {
  return (
    <div className={styles.household}>
      {members.map((m) => (
        <section key={m.key} aria-label={m.name} className={styles.readOnlyMember}>
          <h2 className={styles.readOnlyName}>
            {m.name} <span className={styles.readOnlyRole}>{m.role}</span>
          </h2>
          {m.rows.length === 0 ? (
            <p className={styles.dek}>Nothing on file yet.</p>
          ) : (
            <dl className={styles.readOnlyList}>
              {m.rows.map((r) => (
                <div key={r.label} className={styles.readOnlyRow}>
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
    </div>
  );
}
