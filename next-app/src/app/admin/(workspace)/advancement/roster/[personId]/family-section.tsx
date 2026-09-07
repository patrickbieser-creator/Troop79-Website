'use client';

/**
 * Household & family section (Phase 2). Household is a DRAFT field — a
 * select of every household plus "no household" — saved through
 * setHousehold, and because moving someone between households is the
 * change a leader most often wants back (Jenna's #5: a live-firing select
 * with no undo), a successful change shows "Household: A → B" with an Undo
 * that calls setHousehold with the previous id. The relationships list is
 * READ-ONLY here; Phase 3 makes it the "Takes effect immediately" block.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../../_components/button';
import { Badge } from '../../../_components/badge';
import { setHousehold } from '../person-actions';
import type { HouseholdChoice, PersonKind } from './record-types';
import { Field, FieldGrid, ReadRow, ReadRows, SectionCard, SectionFormActions, useSectionForm } from './section-card';
import styles from './person-record.module.css';

export interface FamilyDraft extends Record<string, string> {
  /** households.id as a string, or '' for no household. */
  household: string;
}

export interface RelationshipRow {
  id: number;
  outgoing: boolean;
  type: string;
  isGuardian: boolean;
  otherName: string;
}

const REL_WORD: Record<string, string> = {
  parent_of: 'parent of',
  guardian_of: 'guardian of',
  sibling_of: 'sibling of',
  emergency_contact_for: 'emergency contact for'
};

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
  onSaved
}: {
  personId: number;
  name: string;
  kind: PersonKind;
  saved: FamilyDraft;
  households: HouseholdChoice[];
  relationships: RelationshipRow[];
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

  return (
    <SectionCard
      title="Household & family"
      form={form}
      help={
        kind === 'scout' ? (
          <>
            Picking anyone in a household brings up the whole family at signup. Parents and guardians are people in
            their own right — their phone and email are edited on their own record so two scouts can never disagree
            about one parent.
          </>
        ) : (
          <>
            Household membership is independent of roles — it never changes when someone starts or stops helping
            out. Relationships persist through every change of role or status.
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
      <div>
        <p className={styles.listHead}>{kind === 'scout' ? 'Parents & guardians' : 'Relationships'}</p>
        {relationships.length ? (
          <ul className={styles.list}>
            {relationships.map((r) => (
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
    </SectionCard>
  );
}
