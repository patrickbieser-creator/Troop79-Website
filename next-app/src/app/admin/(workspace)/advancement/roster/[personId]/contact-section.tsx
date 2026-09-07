'use client';

/**
 * Contact & sign-in section (Phase 2): phone and postal address as the
 * draft form — one action, updatePersonDemographics, sent ONLY these six
 * keys — with the email addresses BELOW the form as the "Takes effect
 * immediately" block (Phase 3, emails-block.tsx): add / make primary /
 * remove commit on click and never share a Save with the form.
 */
import { useRouter } from 'next/navigation';
import type { PersonEmailRow } from '@/lib/person-emails';
import { updatePersonDemographics } from '../person-actions';
import { EmailsBlock } from './emails-block';
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
  onEmailsChanged,
  onSaved
}: {
  personId: number;
  kind: PersonKind;
  saved: ContactDraft;
  emails: PersonEmailRow[];
  /** The refetched list after an add / make primary / remove, for the
   *  header and Sign-in card. */
  onEmailsChanged: (next: PersonEmailRow[]) => void;
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
            A scout with no email of their own signs in through a parent in their household. Addresses are
            one-click: add, promote or remove takes effect right away, which is why that list sits outside the
            form.
          </>
        ) : (
          <>
            The primary address is where sign-in links and the Bugle go. Addresses are one-click: add, promote or
            remove takes effect right away, which is why that list sits outside the form and has no Save.
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
      <EmailsBlock personId={personId} kind={kind} emails={emails} onChanged={onEmailsChanged} />
    </SectionCard>
  );
}
