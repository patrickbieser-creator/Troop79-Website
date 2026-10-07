'use client';

/**
 * Menu Monster leader tools — the one "name a new brand" form (Patrick, 2026-10-05: "we need a way to add a
 * brand on this screen"; 2026-10-06: the suggested-brand pull-down reuses it). A name and Add brand: the
 * brand is made under the ingredient with no price yet. `onAdded` gets the new brand's id so a caller can go
 * on to use it. The caller owns whether the form is open.
 */
import { useState, useTransition } from 'react';
import { Button } from '../../../_components/button';
import { Notice } from '../../_components/notice';
import type { Ingredient } from '@/lib/menu-monster/types';
import { createBrand } from './actions';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

export function AddBrandForm({ ing, onAdded, onCancel }: { ing: Ingredient; onAdded: (brandId: string | null) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={styles.inlineForm}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await createBrand(ing.id, name);
          if (!res.ok) {
            setError(res.error ?? 'Something went wrong.');
            return;
          }
          setName('');
          onAdded(res.id ?? null);
        });
      }}
    >
      <input className={lib.textInput} aria-label={`New brand of ${ing.name.toLowerCase()}`} value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
      <Button type="submit" variant="primary" disabled={pending || !name.trim()}>
        Add brand
      </Button>
      <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
        Cancel
      </Button>
      {error && <Notice>{error}</Notice>}
    </form>
  );
}
