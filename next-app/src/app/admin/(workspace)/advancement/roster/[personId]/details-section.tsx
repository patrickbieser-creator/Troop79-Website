'use client';

/**
 * Details section (Phase 2). Two shapes, one shell:
 *
 *   Adult — first/last name (required), birthdate, BSA member ID, YPT
 *           completed, health form, things we should know. One action:
 *           updatePersonDemographics, sent ONLY these keys.
 *   Scout — birthdate, gender, school, grade, swim class, junior-leader
 *           override, health form, things we should know. The people-side
 *           fields go through updatePersonDemographics and the scouts-side
 *           ones through updateScoutFields — each only when its slice of the
 *           draft actually changed, so a Save never writes (or audits) a row
 *           it did not touch. Name and patrol are the Identity section's.
 */
import { useRouter } from 'next/navigation';
import { ageOn, gradeFromGradYear, gradeLabel, gradYearFromGrade, SWIM_CLASS_LABEL, yptStatus } from '@/lib/demographics';
import { fmtDate } from '@/lib/format-date';
import { DatePickerField } from '../../../_components/date-picker-field';
import { updateScoutFields } from '../../lookups/actions';
import { updatePersonDemographics } from '../person-actions';
import { nameBlockedReason } from './identity-section';
import {
  Field,
  FieldGrid,
  ReadRow,
  ReadRows,
  SectionCard,
  SectionFormActions,
  useSectionForm,
  type ActionResult
} from './section-card';
import styles from './person-record.module.css';

export interface AdultDetailsDraft extends Record<string, string> {
  first_name: string;
  last_name: string;
  birthdate: string;
  bsa_member_id: string;
  ypt_completed: string;
  health_form_date: string;
  things_we_should_know: string;
}

export interface ScoutDetailsDraft extends Record<string, string> {
  birthdate: string;
  gender: string;
  school: string;
  /** '' or '0'..'12' — the stored value is graduation_year; see gradeFor/gradYearFor. */
  grade: string;
  swim_class: string;
  junior_leader_override: string;
  health_form_date: string;
  things_we_should_know: string;
}

const GRADES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function gradeFor(gradYear: number | null, today: string): string {
  const g = gradeFromGradYear(gradYear, today);
  return g == null ? '' : String(g);
}

function formDataOf(draft: Record<string, string>, keys: readonly string[]): FormData {
  const fd = new FormData();
  for (const k of keys) fd.set(k, draft[k] ?? '');
  return fd;
}

function changedIn<T extends Record<string, string>>(draft: T, saved: T, keys: readonly (keyof T)[]): boolean {
  return keys.some((k) => draft[k] !== saved[k]);
}

function Birthdate({ value, today }: { value: string; today: string }) {
  if (!value) return null;
  const age = ageOn(value, today);
  return (
    <>
      {fmtDate(value)} {age != null ? <span className={styles.sub}>age {age}</span> : null}
    </>
  );
}

function jlLabel(v: string): string {
  return v === 'yes' ? 'Yes (override)' : v === 'no' ? 'No (override)' : 'Derived from grade';
}

export function AdultDetailsSection({
  personId,
  saved,
  today,
  onSaved
}: {
  personId: number;
  saved: AdultDetailsDraft;
  today: string;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const form = useSectionForm<AdultDetailsDraft>({
    key: 'details',
    title: 'Details',
    saved,
    save: (draft) => updatePersonDemographics(personId, formDataOf(draft, Object.keys(saved))),
    blockedReason: nameBlockedReason,
    onSaved: () => {
      router.refresh();
      onSaved?.();
    }
  });
  const d = form.draft;
  const v = form.saved;
  const ypt = yptStatus(v.ypt_completed || null, today);

  return (
    <SectionCard
      title="Details"
      form={form}
      help={
        <>
          YPT is good for two years. &ldquo;Things we should know&rdquo; is visible to leaders only and feeds the
          per-event needs report.
        </>
      }
    >
      {!form.editing ? (
        <ReadRows>
          <ReadRow label="First name">{v.first_name}</ReadRow>
          <ReadRow label="Last name">{v.last_name}</ReadRow>
          <ReadRow label="Birthdate">
            <Birthdate value={v.birthdate} today={today} />
          </ReadRow>
          <ReadRow label="BSA member ID">{v.bsa_member_id ? <span className={styles.mono}>{v.bsa_member_id}</span> : null}</ReadRow>
          <ReadRow label="YPT completed">
            {v.ypt_completed ? (
              <>
                {fmtDate(v.ypt_completed)}{' '}
                <span className={styles.sub}>
                  {ypt.status === 'expired' ? 'EXPIRED' : ypt.status} · expires {fmtDate(ypt.expires)}
                </span>
              </>
            ) : null}
          </ReadRow>
          <ReadRow label="Health form">{v.health_form_date ? fmtDate(v.health_form_date) : null}</ReadRow>
          <ReadRow label="Things we should know">{v.things_we_should_know}</ReadRow>
        </ReadRows>
      ) : (
        <>
          <FieldGrid>
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
            <Field label="Birthdate">
              <DatePickerField value={d.birthdate} disabled={form.busy} onChange={(iso) => form.setField('birthdate', iso)} />
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
            <Field label="YPT completed">
              <DatePickerField
                value={d.ypt_completed}
                disabled={form.busy}
                onChange={(iso) => form.setField('ypt_completed', iso)}
              />
            </Field>
            <Field label="Health form">
              <DatePickerField
                value={d.health_form_date}
                disabled={form.busy}
                onChange={(iso) => form.setField('health_form_date', iso)}
              />
            </Field>
            <Field label="Things we should know" full>
              <textarea
                rows={3}
                value={d.things_we_should_know}
                disabled={form.busy}
                placeholder="e.g. Peanut allergy (EpiPen in backpack), asthma inhaler"
                onChange={(e) => form.setField('things_we_should_know', e.target.value)}
              />
            </Field>
          </FieldGrid>
          <SectionFormActions form={form} doneLabel="Details saved." />
        </>
      )}
    </SectionCard>
  );
}

const SCOUT_PEOPLE_KEYS = ['birthdate', 'gender', 'health_form_date', 'things_we_should_know'] as const;
const SCOUT_ROW_KEYS = ['school', 'grade', 'swim_class', 'junior_leader_override'] as const;

export function ScoutDetailsSection({
  personId,
  scoutId,
  saved,
  today,
  onSaved
}: {
  personId: number;
  scoutId: string;
  saved: ScoutDetailsDraft;
  today: string;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const form = useSectionForm<ScoutDetailsDraft>({
    key: 'details',
    title: 'Details',
    saved,
    save: async (draft, prev): Promise<ActionResult> => {
      if (changedIn(draft, prev, SCOUT_PEOPLE_KEYS)) {
        const res = await updatePersonDemographics(personId, formDataOf(draft, SCOUT_PEOPLE_KEYS));
        if (!res.ok) return res;
      }
      if (changedIn(draft, prev, SCOUT_ROW_KEYS)) {
        const jl = draft.junior_leader_override;
        return updateScoutFields(scoutId, {
          school: draft.school || null,
          graduation_year: draft.grade === '' ? null : gradYearFromGrade(Number(draft.grade), today),
          swim_class: draft.swim_class || null,
          junior_leader_override: jl === 'yes' || jl === 'no' ? jl : null
        });
      }
      return { ok: true };
    },
    onSaved: () => {
      router.refresh();
      onSaved?.();
    }
  });
  const d = form.draft;
  const v = form.saved;
  const gradeRead = v.grade === '' ? null : Number(v.grade);

  return (
    <SectionCard
      title="Details"
      form={form}
      help={
        <>
          Age and grade are derived — the stored value is the graduation class year; grade advances each June 15.
          Junior Leader follows grade 9–12 unless pinned here. &ldquo;Things we should know&rdquo; is visible to
          leaders only.
        </>
      }
    >
      {!form.editing ? (
        <ReadRows>
          <ReadRow label="Birthdate">
            <Birthdate value={v.birthdate} today={today} />
          </ReadRow>
          <ReadRow label="Gender">{v.gender === 'M' ? 'Male' : v.gender === 'F' ? 'Female' : ''}</ReadRow>
          <ReadRow label="School">{v.school}</ReadRow>
          <ReadRow label="Grade" derived>
            {gradeRead == null ? '' : `${gradeLabel(gradeRead)} · class of ${gradYearFromGrade(gradeRead, today)}`}
          </ReadRow>
          <ReadRow label="Swim class">{v.swim_class ? SWIM_CLASS_LABEL[v.swim_class] : ''}</ReadRow>
          <ReadRow label="Junior leader">{jlLabel(v.junior_leader_override)}</ReadRow>
          <ReadRow label="Health form">{v.health_form_date ? fmtDate(v.health_form_date) : null}</ReadRow>
          <ReadRow label="Things we should know">{v.things_we_should_know}</ReadRow>
        </ReadRows>
      ) : (
        <>
          <FieldGrid>
            <Field label="Birthdate">
              <DatePickerField value={d.birthdate} disabled={form.busy} onChange={(iso) => form.setField('birthdate', iso)} />
            </Field>
            <Field label="Gender">
              <select value={d.gender} disabled={form.busy} onChange={(e) => form.setField('gender', e.target.value)}>
                <option value="">—</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </Field>
            <Field label="School">
              <input
                type="text"
                value={d.school}
                disabled={form.busy}
                placeholder="e.g. Milwaukee German Immersion"
                onChange={(e) => form.setField('school', e.target.value)}
              />
            </Field>
            <Field label={d.grade === '' ? 'Grade' : `Grade · class of ${gradYearFromGrade(Number(d.grade), today)}`}>
              <select value={d.grade} disabled={form.busy} onChange={(e) => form.setField('grade', e.target.value)}>
                <option value="">—</option>
                {GRADES.map((g) => (
                  <option key={g} value={String(g)}>
                    {gradeLabel(g)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Swim classification">
              <select value={d.swim_class} disabled={form.busy} onChange={(e) => form.setField('swim_class', e.target.value)}>
                <option value="">—</option>
                {Object.entries(SWIM_CLASS_LABEL).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Junior leader (sign-ups)">
              <select
                value={d.junior_leader_override}
                disabled={form.busy}
                onChange={(e) => form.setField('junior_leader_override', e.target.value)}
              >
                <option value="">Auto — grades 9–12</option>
                <option value="yes">Yes — always a Junior Leader</option>
                <option value="no">No — always a Scout</option>
              </select>
            </Field>
            <Field label="Health form">
              <DatePickerField
                value={d.health_form_date}
                disabled={form.busy}
                onChange={(iso) => form.setField('health_form_date', iso)}
              />
            </Field>
            <Field label="Things we should know" full>
              <textarea
                rows={3}
                value={d.things_we_should_know}
                disabled={form.busy}
                placeholder="e.g. Peanut allergy (EpiPen in backpack), asthma inhaler"
                onChange={(e) => form.setField('things_we_should_know', e.target.value)}
              />
            </Field>
          </FieldGrid>
          <SectionFormActions form={form} doneLabel="Details saved." />
        </>
      )}
    </SectionCard>
  );
}
