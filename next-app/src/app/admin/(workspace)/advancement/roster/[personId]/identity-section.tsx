'use client';

/**
 * Identity section (scouts only, Phase 2): internal id (read-only), first
 * and last name (required), BSA member ID, patrol, and the derived rank.
 * Save → updateScoutIdentity, which writes the scouts row AND the linked
 * person's name/BSA id — one action, only this section's fields.
 */
import { useRouter } from 'next/navigation';
import { updateScoutIdentity } from '../../lookups/actions';
import {
  Field,
  FieldGrid,
  ReadOnlyField,
  ReadRow,
  ReadRows,
  SectionCard,
  SectionFormActions,
  useSectionForm
} from './section-card';
import styles from './person-record.module.css';

export interface IdentityDraft extends Record<string, string> {
  first_name: string;
  last_name: string;
  bsa_member_id: string;
  patrol: string;
}

export const NAME_REQUIRED = 'First and last name are required';

export function nameBlockedReason(d: { first_name: string; last_name: string }): string | null {
  return d.first_name.trim() && d.last_name.trim() ? null : NAME_REQUIRED;
}

export function IdentitySection({
  scoutId,
  saved,
  rankLabel,
  onSaved
}: {
  scoutId: string;
  saved: IdentityDraft;
  rankLabel: string | null;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const form = useSectionForm<IdentityDraft>({
    key: 'identity',
    title: 'Identity',
    saved,
    save: (draft) => updateScoutIdentity(scoutId, draft),
    blockedReason: nameBlockedReason,
    onSaved: () => {
      router.refresh();
      onSaved?.();
    }
  });
  const d = form.draft;
  const v = form.saved;

  return (
    <SectionCard title="Identity" form={form}>
      {!form.editing ? (
        <ReadRows>
          <ReadRow label="Internal ID">
            <span className={styles.mono}>{scoutId}</span>
          </ReadRow>
          <ReadRow label="First name">{v.first_name}</ReadRow>
          <ReadRow label="Last name">{v.last_name}</ReadRow>
          <ReadRow label="BSA member ID">{v.bsa_member_id ? <span className={styles.mono}>{v.bsa_member_id}</span> : null}</ReadRow>
          <ReadRow label="Patrol">{v.patrol}</ReadRow>
          <ReadRow label="Current rank" derived>
            {rankLabel ?? <span className={styles.empty}>no rank earned yet</span>}
          </ReadRow>
        </ReadRows>
      ) : (
        <>
          <FieldGrid>
            <ReadOnlyField label="Internal ID" mono>
              {scoutId}
            </ReadOnlyField>
            <ReadOnlyField label="Current rank · derived">{rankLabel ?? 'no rank earned yet'}</ReadOnlyField>
            <Field label="First name" required error={d.first_name.trim() ? null : 'First name is required'}>
              <input
                type="text"
                value={d.first_name}
                disabled={form.busy}
                aria-invalid={d.first_name.trim() ? undefined : true}
                onChange={(e) => form.setField('first_name', e.target.value)}
              />
            </Field>
            <Field label="Last name" required error={d.last_name.trim() ? null : 'Last name is required'}>
              <input
                type="text"
                value={d.last_name}
                disabled={form.busy}
                aria-invalid={d.last_name.trim() ? undefined : true}
                onChange={(e) => form.setField('last_name', e.target.value)}
              />
            </Field>
            <Field label="BSA member ID">
              <input
                type="text"
                value={d.bsa_member_id}
                disabled={form.busy}
                className={styles.mono}
                onChange={(e) => form.setField('bsa_member_id', e.target.value)}
              />
            </Field>
            <Field label="Patrol">
              <input
                type="text"
                value={d.patrol}
                disabled={form.busy}
                placeholder="e.g. Hawk"
                onChange={(e) => form.setField('patrol', e.target.value)}
              />
            </Field>
          </FieldGrid>
          <SectionFormActions form={form} doneLabel="Identity saved." />
        </>
      )}
    </SectionCard>
  );
}
