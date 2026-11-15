'use client';

/**
 * School picker for leaders (Plans/Person-Record-One-Save.md "Schools"; lib/schools.ts). The AdminCombobox with
 * its extras on: type to filter, the typed text bolded, × clears, ▾ toggles, arrows / Enter / Esc. The last
 * option, `+ Add “<typed>” as a new school`, opens a small dialog for the full name (prefilled with the typed
 * text); Add school calls `onAddSchool` (the addSchool server action) and picks the row it returns. There is no
 * Add option when the typed text already names an offered school (case and spacing ignored), and the server
 * returns the existing row anyway if it races.
 *
 * Hidden schools (active = false) are not offered, but the scout's current one still shows as the value.
 * Families get the public twin, src/app/_components/school-picker.tsx (no dialog; their add is a proposal).
 * Specimen: /admin/styleguide/admin -> Combobox -> School picker.
 */
import { useEffect, useRef, useState } from 'react';
import { AdminCombobox, type ComboOption } from './admin-combobox';
import { Dialog, DialogActions, DialogBody, DialogHeader } from './dialog';
import { Button } from '../../_components/button';
import { cleanSchoolName, findSchoolByName, sortSchools, SCHOOL_NAME_MAX, type School } from '@/lib/schools';
import s from './school-combobox.module.css';

export type AddSchoolAction = (name: string) => Promise<{ ok: boolean; school?: School; error?: string }>;

export function SchoolCombobox({
  id,
  label = 'School',
  schools,
  value,
  onChange,
  onAddSchool,
  invalid = false,
  disabled = false
}: {
  id: string;
  label?: string;
  /** Every school, hidden ones too (listSchools). */
  schools: readonly School[];
  /** schools.id; null = no school. */
  value: number | null;
  onChange: (id: number | null, school: School | null) => void;
  onAddSchool: AddSchoolAction;
  invalid?: boolean;
  disabled?: boolean;
}) {
  // Schools added here show at once, before the caller's list refreshes.
  const [made, setMade] = useState<School[]>([]);
  const all = [...schools, ...made.filter((m) => !schools.some((x) => x.id === m.id))];
  const offered = sortSchools(all.filter((x) => x.active || x.id === value));
  const options: ComboOption[] = offered.map((x) => ({
    value: String(x.id),
    label: x.name,
    detail: !x.active ? 'hidden' : (x.short_name ?? undefined),
    keywords: x.short_name ? [x.short_name] : undefined
  }));

  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (adding !== null && !dlg.open) dlg.showModal();
    if (adding === null && dlg.open) dlg.close();
  }, [adding]);

  const clean = cleanSchoolName(adding ?? '');
  const exact = clean ? findSchoolByName(offered, clean) : undefined;

  async function add() {
    if (!clean || busy) return;
    if (exact) {
      onChange(exact.id, exact);
      setAdding(null);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await onAddSchool(clean);
    setBusy(false);
    if (!res.ok || !res.school) {
      setError(res.error ?? 'Could not add the school.');
      return;
    }
    const school = res.school;
    setMade((m) => [...m.filter((x) => x.id !== school.id), school]);
    onChange(school.id, school);
    setAdding(null);
  }

  return (
    <>
      <AdminCombobox
        id={id}
        label={label}
        options={options}
        value={value != null ? String(value) : ''}
        onChange={(v) => {
          const picked = v === '' ? null : (all.find((x) => String(x.id) === v) ?? null);
          onChange(picked?.id ?? null, picked);
        }}
        invalid={invalid}
        disabled={disabled}
        placeholder="Type to search schools…"
        highlight
        toggle
        extraOption={{
          label: (typed) => (findSchoolByName(offered, typed) ? null : `+ Add “${cleanSchoolName(typed)}” as a new school`),
          onPick: (typed) => {
            setError(null);
            setAdding(cleanSchoolName(typed));
          }
        }}
      />
      <Dialog ref={dialogRef} className={s.dialog} onClose={() => setAdding(null)}>
        {adding !== null && (
          <>
            <DialogHeader title="Add a school" sub="It joins the school list every leader and family picks from." />
            <DialogBody>
              <label className={s.field}>
                Full school name
                <input
                  type="text"
                  value={adding}
                  autoFocus
                  maxLength={SCHOOL_NAME_MAX}
                  disabled={busy}
                  aria-invalid={error ? true : undefined}
                  onChange={(e) => setAdding(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void add();
                    }
                  }}
                />
              </label>
              <p className={s.hint}>Spell it out, e.g. &ldquo;Shorewood High School&rdquo;, not &ldquo;Shorewood HS&rdquo;.</p>
              {exact && <p className={s.hint}>&ldquo;{exact.name}&rdquo; is already on the list; Add school picks it.</p>}
              {error && (
                <p className={s.error} role="alert">
                  {error}
                </p>
              )}
            </DialogBody>
            <DialogActions>
              <Button variant="secondary" disabled={busy} onClick={() => setAdding(null)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={busy || !clean} onClick={() => void add()}>
                {busy ? 'Adding…' : 'Add school'}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}
