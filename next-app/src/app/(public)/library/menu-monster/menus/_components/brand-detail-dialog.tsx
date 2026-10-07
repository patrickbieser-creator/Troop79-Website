'use client';

/**
 * The brand detail dialog (Plans/Menu-Monster-Brand-Detail.md; prototype menu-monster-add-pattern, Dialog variant):
 * what a scout knows about a brand while it is in their hand: how big the bag is, what it cost, where. It opens when
 * a brand is typed and from the size control in a brand's quantity row, never from a chip tap (a chip still picks).
 * The body is AddPackageForm in dialog mode, so the package goes through the same scout-package action as the
 * "No price yet" path. A native modal <dialog>: focus is held inside, Esc closes (the form's own Escape handler, or the browser's cancel when focus is outside it). The chooser owns where focus
 * goes back to.
 */

import { useEffect, useId, useRef } from 'react';
import type { Brand, Conversion, Ingredient } from '@/lib/menu-monster/types';
import { AddPackageForm, type AddedPackage } from './add-package-form';
import s from './workspace.module.css';

export function BrandDetailDialog({
  ingredient,
  brand,
  conversions,
  stores,
  onAdded,
  onClose
}: {
  ingredient: Ingredient;
  brand: Brand;
  conversions: readonly Conversion[];
  stores: readonly string[];
  onAdded: (a: AddedPackage) => void;
  /** Cancel, Esc or Save: the chooser puts focus back on whatever opened this. */
  onClose: () => void;
}) {
  const uid = useId();
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
    dlg.querySelector<HTMLElement>('[data-field="size"]')?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      className={s.detailDialog}
      aria-labelledby={`${uid}-h`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id={`${uid}-h`} className={s.detailTitle}>
        {brand.name} — {ingredient.name}
      </h2>
      <AddPackageForm ingredient={ingredient} conversions={conversions} brand={brand} stores={stores} onAdded={onAdded} onCancel={onClose} />
    </dialog>
  );
}
