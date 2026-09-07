'use client';

/**
 * Household & family section (Phase 2). Household is a DRAFT field — a
 * select of every household plus "no household" — saved through
 * setHousehold, and because moving someone between households is the
 * change a leader most often wants back (Jenna's #5: a live-firing select
 * with no undo), a successful change shows "Household: A → B" with an Undo
 * that calls setHousehold with the previous id. Relationships / parents &
 * guardians sit BELOW the form as the "Takes effect immediately" block
 * (Phase 3, relationships-block.tsx), outside any Save.
 */
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '../../../../_components/button';
import { setHousehold, type PersonDetail } from '../person-actions';
import { RelationshipsBlock, type RelationshipRow } from './relationships-block';
import type { HouseholdChoice, HouseholdMember, PersonKind } from './record-types';

const KIND_LABEL: Record<PersonKind, string> = { scout: 'Scout', leader: 'Leader', adult: 'Adult' };
import { Field, FieldGrid, ReadRow, ReadRows, SectionCard, SectionFormActions, useSectionForm } from './section-card';
import styles from './person-record.module.css';

export type { RelationshipRow } from './relationships-block';

export interface FamilyDraft extends Record<string, string> {
  /** households.id as a string, or '' for no household. */
  household: string;
}

const TOAST_MS = 5000;
const TOAST_UNDO_MS = 8000;

interface Toast {
  message: string;
  undo?: () => void;
}

export function FamilySection({
  personId,
  name,
  kind,
  saved,
  households,
  relationships,
  members = [],
  memberHref,
  onRelationshipsChanged,
  banner,
  onSaved
}: {
  personId: number;
  name: string;
  kind: PersonKind;
  saved: FamilyDraft;
  households: HouseholdChoice[];
  relationships: RelationshipRow[];
  /** Everyone in the current household (the person themself included — they
   *  are filtered out here). Patrick, 2026-09-07: an adult's or leader's
   *  record must show the other adults in the household, not only the
   *  scouts that surface through relationships. */
  members?: HouseholdMember[];
  /** Builds the record-page link for a household member. */
  memberHref?: (personId: number) => string;
  /** Pending-update banner for this section (Phase 5), if any. */
  banner?: ReactNode;
  /** The refetched detail after a link / unlink, for the header's
   *  "signs in through …" line and the roles list. */
  onRelationshipsChanged: (detail: PersonDetail) => void;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [toast, setToast] = useState<Toast | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const labelOf = (value: string) => (value ? (households.find((h) => String(h.id) === value)?.label ?? `household ${value}`) : 'no household');
  const idOf = (value: string) => (value ? Number(value) : null);

  const form = useSectionForm<FamilyDraft>({
    key: 'family',
    title: 'Household & family',
    saved,
    save: (draft) => setHousehold(personId, idOf(draft.household)),
    onSaved: (next, prev) => {
      router.refresh();
      onSaved?.();
      if (next.household === prev.household) return;
      setToast({
        message: `Household: ${labelOf(prev.household)} → ${labelOf(next.household)}`,
        undo: () => {
          setUndoBusy(true);
          void setHousehold(personId, idOf(prev.household))
            .then((res) => {
              if (!res.ok) {
                setToast({ message: res.error ?? 'Could not undo the household change.' });
                return;
              }
              form.replaceSaved(prev);
              setToast({ message: 'Household change undone.' });
              router.refresh();
              onSaved?.();
            })
            .finally(() => setUndoBusy(false));
        }
      });
    }
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? TOAST_UNDO_MS : TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const v = form.saved;
  const d = form.draft;
  const others = members.filter((m) => m.personId !== personId);

  return (
    <SectionCard
      title="Household & family"
      form={form}
      banner={banner}
      help={
        kind === 'scout' ? (
          <>
            Picking anyone in a household brings up the whole family at signup. Parents and guardians are people in
            their own right — their phone and email are edited on their own record so two scouts can never disagree
            about one parent. Linking and unlinking takes effect right away.
          </>
        ) : (
          <>
            Household membership is independent of roles — it never changes when someone starts or stops helping
            out. Relationships persist through every change of role or status, and take effect right away.
          </>
        )
      }
    >
      {toast && (
        <div className={styles.toast} role="status" aria-label="Household changed">
          <span className={styles.grow}>{toast.message}</span>
          {toast.undo ? (
            <Button size="sm" disabled={undoBusy} onClick={toast.undo}>
              Undo
            </Button>
          ) : null}
          <button type="button" className={styles.toastClose} aria-label="Dismiss" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
      {!form.editing ? (
        <ReadRows>
          <ReadRow label="Household">{v.household ? labelOf(v.household) : null}</ReadRow>
          {v.household ? (
            <ReadRow label="Members">
              {others.length === 0 ? (
                <span className={styles.muted}>No one else in this household yet.</span>
              ) : (
                <ul className={styles.memberList} aria-label="Household members">
                  {others.map((m) => (
                    <li key={m.personId}>
                      {memberHref ? <Link href={memberHref(m.personId)}>{m.name}</Link> : m.name}
                      <span className={styles.muted}>
                        {' '}
                        · {KIND_LABEL[m.kind]}
                        {m.active ? '' : ' · inactive'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ReadRow>
          ) : null}
        </ReadRows>
      ) : (
        <>
          <FieldGrid>
            <Field label="Household" full>
              <select value={d.household} disabled={form.busy} onChange={(e) => form.setField('household', e.target.value)}>
                <option value="">— no household —</option>
                {households.map((h) => (
                  <option key={h.id} value={String(h.id)}>
                    {h.label}
                  </option>
                ))}
              </select>
            </Field>
          </FieldGrid>
          <SectionFormActions form={form} doneLabel="Household saved." />
        </>
      )}
      <RelationshipsBlock
        personId={personId}
        name={name}
        kind={kind}
        relationships={relationships}
        onChanged={onRelationshipsChanged}
      />
    </SectionCard>
  );
}
