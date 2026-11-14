'use client';

/**
 * Where families send event fees (Patrick, 2026-11-13): entered once here, listed on every event's sign-up as
 * "How will you pay?". Same shape as SiteTextEditor: one field per site_settings key, one Save. A blank Venmo or
 * PayPal field takes that method off the list; cash, check, scout account and card are always offered.
 */

import { useState, useTransition } from 'react';
import { DiscardButton, SaveButton, SaveFeedback, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import { PAY_TO_KEYS } from '@/lib/event-pay/options';
import styles from './lookups.module.css';
import { Notice } from '../../_components/notice';
import { FormPanel } from '../../../_components/form-panel';

type PayToKey = (typeof PAY_TO_KEYS)[number];
type ActionResult = { ok: boolean; error?: string };

const FIELDS: { key: PayToKey; label: string; hint: string; full?: boolean }[] = [
  { key: 'pay.venmo_handle', label: 'Venmo handle', hint: 'With the @. Blank takes Venmo off the list.' },
  { key: 'pay.venmo_hint', label: 'Venmo check', hint: 'What Venmo asks to confirm the person, e.g. “last 4 of phone 6423”.' },
  { key: 'pay.paypal_email', label: 'PayPal address', hint: 'Blank takes PayPal off the list.' },
  { key: 'pay.check_payable_to', label: 'Checks payable to', hint: 'Blank reads “Troop 79”.' },
  { key: 'pay.check_mail_to', label: 'Mail checks to', hint: 'Name and address on one line. Blank = meetings only.', full: true }
];

export function PayToEditor({ values, onSave }: { values: Partial<Record<PayToKey, string>>; onSave: (fd: FormData) => Promise<ActionResult> }) {
  const [draft, setDraft] = useState<Partial<Record<PayToKey, string>>>(() => ({ ...values }));
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { dirty, markSaved, saved: savedDraft } = useDraftSnapshot(draft);
  const feedback = useSavePhase();

  function save() {
    setErr(null);
    const fd = new FormData();
    for (const f of FIELDS) fd.set(f.key, (draft[f.key] ?? '').trim());
    feedback.start();
    startTransition(async () => {
      const res = await onSave(fd);
      if (!res.ok) {
        feedback.fail();
        setErr(res.error ?? 'Save failed');
        return;
      }
      markSaved();
      feedback.done();
    });
  }

  return (
    <FormPanel>
      <div className={styles.fieldGrid}>
        {FIELDS.map((f) => (
          <label key={f.key} className={`${styles.editField} ${f.full ? styles.editFieldFull : ''}`}>
            <span className={styles.editLabel}>{f.label}</span>
            <input
              type="text"
              className={styles.editInput}
              value={draft[f.key] ?? ''}
              onChange={(e) => setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
            <span className={styles.helpText}>{f.hint}</span>
          </label>
        ))}
      </div>
      {err && <Notice variant="error">{err}</Notice>}
      <div className={styles.editActions}>
        <DiscardButton dirty={dirty} pending={isPending} onClick={() => { setDraft(savedDraft); setErr(null); }} />
        <SaveButton dirty={dirty} pending={isPending} onClick={save} />
        <SaveFeedback phase={feedback.phase} />
      </div>
    </FormPanel>
  );
}
