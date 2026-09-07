'use client';

/**
 * Contact & sign-in section (Phase 2): phone and postal address as the
 * draft form — one action, updatePersonDemographics, sent ONLY these six
 * keys — with the email-address list READ-ONLY beneath it. Phase 3 turns the
 * list into the "Takes effect immediately" block (add / make primary /
 * remove); until then addresses are edited from the roster list.
 */
import { useRouter } from 'next/navigation';
import { fmtDate } from '@/lib/format-date';
import type { PersonEmailRow } from '@/lib/person-emails';
import { Badge } from '../../../_components/badge';
import { updatePersonDemographics } from '../person-actions';
import type { PersonKind } from './record-types';
import { Field, FieldGrid, ReadRow, ReadRows, SectionCard, SectionFormActions, useSectionForm } from './section-card';
import styles from './person-record.module.css';

export interface ContactDraft extends Record<string, string> {
  primary_phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
}

const CONTACT_KEYS = [
  'primary_phone',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip'
] as const;

export function ContactSection({
  personId,
  kind,
  saved,
  emails,
  onSaved
}: {
  personId: number;
  kind: PersonKind;
  saved: ContactDraft;
  emails: PersonEmailRow[];
  onSaved?: () => void;
}) {
  const router = useRouter();
  const form = useSectionForm<ContactDraft>({
    key: 'contact',
    title: 'Contact & sign-in',
    saved,
    save: (draft) => {
      const fd = new FormData();
      for (const k of CONTACT_KEYS) fd.set(k, draft[k]);
      return updatePersonDemographics(personId, fd);
    },
    onSaved: () => {
      router.refresh();
      onSaved?.();
    }
  });
  const d = form.draft;
  const v = form.saved;
  const addressLines = [
    v.address_line1,
    v.address_line2,
    [v.city, v.state].filter(Boolean).join(', ') + (v.zip ? ` ${v.zip}` : '')
  ].filter((line) => line.trim());

  return (
    <SectionCard
      title="Contact & sign-in"
      form={form}
      help={
        kind === 'scout' ? (
          <>
            A scout with no email of their own signs in through a parent in their household. Until the next phase,
            addresses are added, promoted or removed from the roster list.
          </>
        ) : (
          <>
            The primary address is where sign-in links and the Bugle go. Until the next phase, addresses are
            added, promoted or removed from the roster list; the list is separate from the form on purpose.
          </>
        )
      }
    >
      {!form.editing ? (
        <ReadRows>
          <ReadRow label="Phone">{v.primary_phone ? <a href={`tel:${v.primary_phone}`}>{v.primary_phone}</a> : null}</ReadRow>
          <ReadRow label="Address">
            {addressLines.map((line, i) => (
              <span key={i} className={i === 0 ? undefined : styles.sub}>
                {line}
              </span>
            ))}
          </ReadRow>
        </ReadRows>
      ) : (
        <>
          <FieldGrid>
            <Field label="Phone">
              <input
                type="tel"
                value={d.primary_phone}
                disabled={form.busy}
                placeholder="(414) 555-1234"
                onChange={(e) => form.setField('primary_phone', e.target.value)}
              />
            </Field>
            <Field label="Address line 1" full>
              <input
                type="text"
                value={d.address_line1}
                disabled={form.busy}
                onChange={(e) => form.setField('address_line1', e.target.value)}
              />
            </Field>
            <Field label="Address line 2" full>
              <input
                type="text"
                value={d.address_line2}
                disabled={form.busy}
                placeholder="Apt / unit (optional)"
                onChange={(e) => form.setField('address_line2', e.target.value)}
              />
            </Field>
            <Field label="City">
              <input type="text" value={d.city} disabled={form.busy} onChange={(e) => form.setField('city', e.target.value)} />
            </Field>
            <Field label="State">
              <input
                type="text"
                value={d.state}
                disabled={form.busy}
                maxLength={2}
                placeholder="WI"
                onChange={(e) => form.setField('state', e.target.value)}
              />
            </Field>
            <Field label="ZIP">
              <input
                type="text"
                value={d.zip}
                disabled={form.busy}
                placeholder="53202"
                onChange={(e) => form.setField('zip', e.target.value)}
              />
            </Field>
          </FieldGrid>
          <SectionFormActions form={form} doneLabel="Contact details saved." />
        </>
      )}
      <EmailList emails={emails} kind={kind} />
    </SectionCard>
  );
}

function EmailList({ emails, kind }: { emails: PersonEmailRow[]; kind: PersonKind }) {
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
