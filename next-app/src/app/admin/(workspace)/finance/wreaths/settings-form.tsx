'use client';

/**
 * Wreath sale › Settings: status, the two cutoffs, distribution day, the delivery area and fee, the processing-fee
 * formula and the scouts' share. One form, numbered sections under ONE sticky bar (Save changes / Saved + Discard
 * changes). Save is dirty-gated; a dirty but incomplete form keeps Save enabled and marks every bad field in place with
 * its reason (the blocked-save standard). Cutoffs are dates; each is the END of that day, Central.
 */

import { useState, useTransition } from 'react';
import { FormSection } from '../../../_components/form-panel';
import { DatePickerField } from '../../_components/date-picker-field';
import { DiscardButton, SaveButton, SaveFeedback, SaveProblem, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import { SegmentedControl } from '../../_components/segmented-control';
import { Notice } from '../../_components/notice';
import { instantToCentral } from '@/lib/dates';
import type { AdminSale } from '@/lib/wreaths/admin-data';
import { zipPrefixListOk } from '@/lib/wreaths/rules';
import { saveSettings, type SettingsInput } from './actions';
import styles from './wreaths.module.css';

interface Draft {
  status: SettingsInput['status'];
  round1Date: string;
  round2Date: string;
  distributionDate: string;
  distributionWindow: string;
  distributionPlace: string;
  deliveryZipPrefix: string;
  deliveryFee: string;
  deliveryFreeAt: string;
  feePercent: string;
  feeFixed: string;
  scoutSharePercent: string;
}

function toDraft(s: AdminSale): Draft {
  return {
    status: s.status,
    round1Date: instantToCentral(s.round1Cutoff).date,
    round2Date: instantToCentral(s.round2Cutoff).date,
    distributionDate: s.distributionDate ?? '',
    distributionWindow: s.distributionWindow,
    distributionPlace: s.distributionPlace,
    deliveryZipPrefix: s.deliveryZipPrefix,
    deliveryFee: String(s.deliveryFee),
    deliveryFreeAt: String(s.deliveryFreeAt),
    feePercent: String(s.feePercent),
    feeFixed: String(s.feeFixed),
    scoutSharePercent: String(Math.round(s.scoutShare * 1000) / 10)
  };
}

const num = (t: string) => (t.trim() === '' ? Number.NaN : Number(t));

function problemsOf(d: Draft): Record<string, string> {
  const p: Record<string, string> = {};
  if (!d.round1Date) p.round1Date = 'Enter the Round 1 cutoff date.';
  if (!d.round2Date) p.round2Date = 'Enter the Round 2 cutoff date.';
  else if (d.round1Date && d.round2Date <= d.round1Date) p.round2Date = 'Round 2 must close after Round 1.';
  if (!zipPrefixListOk(d.deliveryZipPrefix)) p.deliveryZipPrefix = 'Zip prefixes are 1 to 5 digits, separated by commas, like 532, 531.';
  const range = (k: keyof Draft, lo: number, hi: number, msg: string) => {
    const n = num(d[k] as string);
    if (!(n >= lo && n <= hi)) p[k] = msg;
  };
  range('deliveryFee', 0, 100, 'The delivery fee is $0 to $100.');
  range('deliveryFreeAt', 0, 10000, 'Free delivery starts at $0 to $10,000.');
  range('feePercent', 0, 10, 'The processing fee percent is 0 to 10.');
  range('feeFixed', 0, 5, 'The fixed processing fee is $0 to $5.');
  range('scoutSharePercent', 0, 100, 'The scout share is 0 to 100 percent.');
  return p;
}

export function SettingsForm({ sale }: { sale: AdminSale }) {
  const initial = toDraft(sale);
  const [draft, setDraft] = useState<Draft>(initial);
  const { dirty, markSaved, saved } = useDraftSnapshot(draft);
  const [pending, start] = useTransition();
  const feedback = useSavePhase();
  const [tried, setTried] = useState(false);
  const [serverProblem, setServerProblem] = useState<{ field?: string; message: string } | null>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const problems = tried ? problemsOf(draft) : {};
  const keys = Object.keys(problems);
  const problemFor = (k: string) => problems[k] ?? (serverProblem?.field === k ? serverProblem.message : undefined);
  const bad = (k: string) => (problemFor(k) ? styles.bad : undefined);

  function save() {
    setTried(true);
    setServerProblem(null);
    if (Object.keys(problemsOf(draft)).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    feedback.start();
    start(async () => {
      const res = await saveSettings(sale.id, {
        status: draft.status,
        round1Date: draft.round1Date,
        round2Date: draft.round2Date,
        distributionDate: draft.distributionDate,
        distributionWindow: draft.distributionWindow,
        distributionPlace: draft.distributionPlace,
        deliveryZipPrefix: draft.deliveryZipPrefix,
        deliveryFee: num(draft.deliveryFee),
        deliveryFreeAt: num(draft.deliveryFreeAt),
        feePercent: num(draft.feePercent),
        feeFixed: num(draft.feeFixed),
        scoutSharePercent: num(draft.scoutSharePercent)
      });
      if (res.ok) {
        markSaved();
        setTried(false);
        feedback.done();
      } else {
        feedback.fail();
        setServerProblem({ field: res.field, message: res.error ?? 'Couldn’t save the settings.' });
      }
    });
  }

  const note = (k: string) => problemFor(k) && <p className={styles.badNote}>{problemFor(k)}</p>;

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate>
      <SaveFeedback phase={feedback.phase} />
      <div className={styles.formStack}>
        <FormSection num={1} title="Status">
          <SegmentedControl
            name="wreath-status"
            label="Sale status"
            value={draft.status}
            onChange={(v) => set('status', v)}
            options={[
              { value: 'draft', label: 'Draft' },
              { value: 'open', label: 'Open' },
              { value: 'closed', label: 'Closed' }
            ]}
          />
          <p className={styles.hint}>
            Draft: the store says it isn’t open yet. Open: it takes orders until the final cutoff. Closed: no new orders at all, whatever the date.
          </p>
        </FormSection>

        <FormSection num={2} title="Cutoffs">
          <div className={styles.grid2}>
            <div className={`${styles.field} ${bad('round1Date') ?? ''}`}>
              <label htmlFor="w-r1">Round 1 closes</label>
              <DatePickerField id="w-r1" value={draft.round1Date} onChange={(v) => set('round1Date', v)} aria-describedby="w-cut-hint" />
              {note('round1Date')}
            </div>
            <div className={`${styles.field} ${bad('round2Date') ?? ''}`}>
              <label htmlFor="w-r2">Round 2 closes</label>
              <DatePickerField id="w-r2" value={draft.round2Date} onChange={(v) => set('round2Date', v)} aria-describedby="w-cut-hint" />
              {note('round2Date')}
            </div>
          </div>
          <p className={styles.hint} id="w-cut-hint">
            Each cutoff is the end of that day, Central time. Round 1 is the initial order to the grower; Round 2 is the top-up. A customer who is already checking out when a cutoff passes has two more hours to finish.
          </p>
        </FormSection>

        <FormSection num={3} title="Distribution day">
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label htmlFor="w-dd">Date</label>
              <DatePickerField id="w-dd" value={draft.distributionDate} onChange={(v) => set('distributionDate', v)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="w-dw">Time window</label>
              <input id="w-dw" type="text" value={draft.distributionWindow} onChange={(e) => set('distributionWindow', e.target.value)} />
            </div>
            <div className={`${styles.field} ${styles.span2}`}>
              <label htmlFor="w-dp">Place</label>
              <input id="w-dp" type="text" value={draft.distributionPlace} onChange={(e) => set('distributionPlace', e.target.value)} />
            </div>
          </div>
        </FormSection>

        <FormSection num={4} title="Delivery">
          <div className={styles.grid2}>
            <div className={`${styles.field} ${bad('deliveryZipPrefix') ?? ''}`}>
              <label htmlFor="w-zip">Zip codes starting with</label>
              <input id="w-zip" type="text" maxLength={40} aria-invalid={problemFor('deliveryZipPrefix') ? true : undefined} value={draft.deliveryZipPrefix} onChange={(e) => set('deliveryZipPrefix', e.target.value)} />
              {note('deliveryZipPrefix')}
            </div>
            <div className={`${styles.field} ${bad('deliveryFee') ?? ''}`}>
              <label htmlFor="w-df">Troop delivery fee ($)</label>
              <input id="w-df" type="number" step="0.01" min={0} aria-invalid={problemFor('deliveryFee') ? true : undefined} value={draft.deliveryFee} onChange={(e) => set('deliveryFee', e.target.value)} />
              {note('deliveryFee')}
            </div>
            <div className={`${styles.field} ${bad('deliveryFreeAt') ?? ''}`}>
              <label htmlFor="w-dfa">Free delivery at ($)</label>
              <input id="w-dfa" type="number" step="0.01" min={0} aria-invalid={problemFor('deliveryFreeAt') ? true : undefined} value={draft.deliveryFreeAt} onChange={(e) => set('deliveryFreeAt', e.target.value)} />
              {note('deliveryFreeAt')}
            </div>
          </div>
          <p className={styles.hint}>
            The fee applies to troop delivery under the “free at” amount of items, before gifts and fees. A scout’s own deliveries never carry a fee.
          </p>
        </FormSection>

        <FormSection num={5} title="Money">
          <div className={styles.grid2}>
            <div className={`${styles.field} ${bad('scoutSharePercent') ?? ''}`}>
              <label htmlFor="w-ss">Scout share of profit (%)</label>
              <input id="w-ss" type="number" step="0.1" min={0} max={100} aria-invalid={problemFor('scoutSharePercent') ? true : undefined} value={draft.scoutSharePercent} onChange={(e) => set('scoutSharePercent', e.target.value)} />
              {note('scoutSharePercent')}
            </div>
            <div className={styles.field} />
            <div className={`${styles.field} ${bad('feePercent') ?? ''}`}>
              <label htmlFor="w-fp">Processing fee (%)</label>
              <input id="w-fp" type="number" step="0.01" min={0} max={10} aria-invalid={problemFor('feePercent') ? true : undefined} value={draft.feePercent} onChange={(e) => set('feePercent', e.target.value)} />
              {note('feePercent')}
            </div>
            <div className={`${styles.field} ${bad('feeFixed') ?? ''}`}>
              <label htmlFor="w-ff">Plus a fixed amount ($)</label>
              <input id="w-ff" type="number" step="0.01" min={0} max={5} aria-invalid={problemFor('feeFixed') ? true : undefined} value={draft.feeFixed} onChange={(e) => set('feeFixed', e.target.value)} />
              {note('feeFixed')}
            </div>
          </div>
          <p className={styles.hint}>The processing fee is only used when PayPal Checkout is live. Until then orders are paid to the treasurer by Venmo or PayPal.</p>
        </FormSection>
      </div>

      {serverProblem && !serverProblem.field && <Notice variant="error">{serverProblem.message}</Notice>}
      <div className={styles.stickyBar}>
        <SaveButton
          dirty={dirty}
          pending={pending}
          blocked={tried && keys.length > 0}
          onBlocked={save}
          onClick={save}
        />
        <DiscardButton
          dirty={dirty}
          pending={pending}
          onClick={() => {
            setDraft(saved);
            setTried(false);
            setServerProblem(null);
          }}
        />
        {keys.length > 0 && <SaveProblem reason={problems[keys[0]]} more={keys.length - 1} />}
        {keys.length === 0 && serverProblem?.field && <SaveProblem reason={serverProblem.message} />}
      </div>
    </form>
  );
}
