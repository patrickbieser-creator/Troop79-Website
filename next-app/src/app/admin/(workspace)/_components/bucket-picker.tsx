'use client';

/**
 * Bucket picker (Plans/Buckets-Lookup.md, 2026-10-17) — pick the money theme a row belongs to: an event, a
 * fundraiser, or a standing bucket like Dividends. An AdminCombobox over every bucket, recently used first.
 *
 * Adding one on the fly is deliberate (Patrick: "require multiple confirmations"):
 *   1. "+ New bucket…" opens a name box. The closest existing buckets are listed first, each with a
 *      "Use …" button that ends the flow. A name that already exists offers that bucket instead.
 *   2. "Create a new bucket…" opens a confirm panel naming the bucket, saying it becomes a choice for
 *      everyone, and listing the near matches again. Only its "Create “…”" button creates it.
 * Back / Cancel at either step create nothing. The database's unique index still guards duplicates.
 * Specimen: /admin/styleguide/admin -> Bucket Picker.
 */
import { useState } from 'react';
import { AdminCombobox } from './admin-combobox';
import { Button } from '../../_components/button';
import { bucketKey, nearBuckets, sortBucketsForPicker, type Bucket } from '@/lib/buckets';
import s from './bucket-picker.module.css';

export function BucketPicker({
  id,
  label,
  buckets,
  value,
  onChange,
  canCreate = false,
  createBucket,
  invalid = false
}: {
  id: string;
  label: string;
  buckets: readonly Bucket[];
  value: number | null;
  onChange: (id: number | null) => void;
  canCreate?: boolean;
  createBucket?: (name: string) => Promise<{ ok: boolean; error?: string; bucket?: Bucket }>;
  invalid?: boolean;
}) {
  // Buckets made here show at once, before the page's list refreshes.
  const [made, setMade] = useState<Bucket[]>([]);
  const all = [...buckets, ...made.filter((m) => !buckets.some((b) => b.id === m.id))];
  const [step, setStep] = useState<'pick' | 'name' | 'confirm'>('pick');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clean = name.trim().replace(/\s+/g, ' ');
  const exact = clean ? all.find((b) => bucketKey(b.name) === bucketKey(clean)) : undefined;
  const near = nearBuckets(all, clean).filter((b) => b !== exact);

  const reset = () => {
    setStep('pick');
    setName('');
    setError(null);
  };
  const choose = (b: Bucket) => {
    onChange(b.id);
    reset();
  };
  async function create() {
    if (!createBucket || !clean) return;
    setBusy(true);
    setError(null);
    const res = await createBucket(clean);
    setBusy(false);
    if (!res.ok || !res.bucket) {
      setError(res.error ?? 'Could not create the bucket.');
      return;
    }
    setMade((m) => [...m, res.bucket!]);
    choose(res.bucket);
  }

  const options = sortBucketsForPicker(all).map((b) => ({ value: String(b.id), label: b.name, detail: b.isEvent ? 'event' : undefined }));
  const pickButtons = (list: Bucket[]) =>
    list.length > 0 && (
      <ul className={s.near}>
        {list.map((b) => (
          <li key={b.id}>
            <Button variant="quiet" size="sm" onClick={() => choose(b)}>
              Use {b.name}
            </Button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className={s.wrap}>
      <AdminCombobox
        id={id}
        label={label}
        options={options}
        value={value != null ? String(value) : ''}
        onChange={(v) => onChange(v === '' ? null : Number(v))}
        invalid={invalid}
        placeholder="Type to search buckets…"
      />
      {canCreate && createBucket && step === 'pick' && (
        <Button variant="quiet" size="sm" onClick={() => setStep('name')}>
          + New bucket…
        </Button>
      )}

      {step === 'name' && (
        <div className={s.panel}>
          <label className={s.field}>
            New bucket name
            <input
              type="text"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault();
                if (e.key === 'Escape') reset();
              }}
            />
          </label>
          {exact ? (
            <>
              <p className={s.note}>“{exact.name}” already exists.</p>
              {pickButtons([exact])}
            </>
          ) : (
            near.length > 0 && (
              <>
                <p className={s.note}>Did you mean one of these?</p>
                {pickButtons(near)}
              </>
            )
          )}
          <div className={s.actions}>
            {!exact && (
              <Button variant="secondary" size="sm" disabled={!clean} onClick={() => setStep('confirm')}>
                Create a new bucket…
              </Button>
            )}
            <Button variant="quiet" size="sm" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className={s.panel + ' ' + s.confirm}>
          <p className={s.confirmTitle}>Create the bucket “{clean}”?</p>
          <p className={s.note}>It becomes a choice for everyone who records troop money, and it shows on the Bucket Report.</p>
          {near.length > 0 && (
            <>
              <p className={s.note}>Check these first — one may already be the right bucket:</p>
              {pickButtons(near)}
            </>
          )}
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <div className={s.actions}>
            <Button variant="primary" size="sm" disabled={busy} onClick={create}>
              {busy ? 'Creating…' : `Create “${clean}”`}
            </Button>
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => setStep('name')}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
