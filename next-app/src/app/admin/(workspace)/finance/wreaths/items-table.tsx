'use client';

/**
 * Wreath sale › Items: the catalog (Rose's 19 items). A DataTable·Card with one quiet Edit per row; Edit opens a
 * dialog whose Save is dirty-gated and whose Cancel is the way back (a dialog's Cancel IS discard). Catalog numbers
 * are Rose's and show here only — the public store never prints them. Changing a price affects NEW orders only: each
 * order line keeps the price and cost it was placed at.
 */

import { useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { Button } from '../../../_components/button';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';
import { Badge } from '../../_components/badge';
import { SaveButton, SaveProblem, useSavedSnapshot } from '../../_components/save-state';
import { Notice } from '../../_components/notice';
import { fmtMoney2 } from '@/lib/wreaths/rules';
import type { AdminItem } from '@/lib/wreaths/admin-data';
import { saveItem, uploadItemImage } from './actions';
import styles from './wreaths.module.css';

export function ItemsTable({ items }: { items: AdminItem[] }) {
  const [editing, setEditing] = useState<AdminItem | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  function open(item: AdminItem) {
    setEditing(item);
    requestAnimationFrame(() => ref.current?.showModal());
  }

  return (
    <>
      <p className={styles.note}>
        Rose’s 19 items. Price is what the customer pays; unit cost is what the troop pays Rose (it never shows publicly). Profit and each scout’s share come from these.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Photo</th>
              <th>No.</th>
              <th>Item</th>
              <th className={styles.numCell}>Price</th>
              <th className={styles.numCell}>Cost</th>
              <th className={styles.numCell}>Profit</th>
              <th>Status</th>
              <th className={styles.actionsCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.imageUrl ? (
                    <Image className={styles.thumb} src={i.imageUrl} alt="" width={44} height={40} />
                  ) : (
                    <span className={styles.muted}>None</span>
                  )}
                </td>
                <td className={styles.mono}>{i.catalogNumber}</td>
                <td>
                  {i.name} {i.size}
                </td>
                <td className={styles.numCell}>{fmtMoney2(i.price)}</td>
                <td className={styles.numCell}>{fmtMoney2(i.unitCost)}</td>
                <td className={styles.numCell}>{fmtMoney2(i.price - i.unitCost)}</td>
                <td>
                  <span className={styles.badgeRow}>
                    {i.active ? <Badge variant="success">On sale</Badge> : <Badge variant="muted">Hidden</Badge>}
                    {i.donatable && <Badge variant="info">Can be donated</Badge>}
                  </span>
                </td>
                <td className={styles.actionsCell}>
                  <Button variant="secondary" size="sm" aria-label={`Edit ${i.name} ${i.size}`} onClick={() => open(i)}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog ref={ref} onClose={() => setEditing(null)}>
        <DialogHeader title={editing ? `Edit ${editing.name} ${editing.size}` : 'Edit item'} sub={editing ? `Rose catalog number ${editing.catalogNumber}` : undefined} />
        {editing && <ItemForm key={editing.id} item={editing} onClose={() => ref.current?.close()} />}
      </Dialog>
    </>
  );
}

function ItemForm({ item, onClose }: { item: AdminItem; onClose: () => void }) {
  const [name, setName] = useState(item.name);
  const [size, setSize] = useState(item.size);
  const [description, setDescription] = useState(item.description);
  const [price, setPrice] = useState(String(item.price));
  const [unitCost, setUnitCost] = useState(String(item.unitCost));
  const [imageUrl, setImageUrl] = useState(item.imageUrl ?? '');
  const [donatable, setDonatable] = useState(item.donatable);
  const [active, setActive] = useState(item.active);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const { dirty } = useSavedSnapshot(JSON.stringify({ name, size, description, price, unitCost, imageUrl, donatable, active }));

  const p: Record<string, string> = {};
  if (tried) {
    if (!name.trim()) p.name = 'Give the item a name.';
    const pn = Number(price);
    if (price.trim() === '' || !(pn >= 0 && pn <= 1000)) p.price = 'The price is $0 to $1,000.';
    const cn = Number(unitCost);
    if (unitCost.trim() === '' || !(cn >= 0 && cn <= 1000)) p.unitCost = 'The unit cost is $0 to $1,000.';
    if (imageUrl.trim() && !/^https:\/\//.test(imageUrl.trim())) p.imageUrl = 'The photo must be an https:// address.';
  }
  const keys = Object.keys(p);
  const problemFor = (k: string) => p[k] ?? (problem?.field === k ? problem.message : undefined);
  const cls = (k: string) => `${styles.field} ${problemFor(k) ? styles.bad : ''}`;
  const note = (k: string) => problemFor(k) && <p className={styles.badNote}>{problemFor(k)}</p>;

  function save() {
    setTried(true);
    setProblem(null);
    if (!name.trim() || !(Number(price) >= 0) || price.trim() === '' || !(Number(unitCost) >= 0) || unitCost.trim() === '') return;
    start(async () => {
      const res = await saveItem(item.id, { name, size, description, price: Number(price), unitCost: Number(unitCost), imageUrl: imageUrl.trim() || null, donatable, active });
      if (res.ok) onClose();
      else setProblem({ field: res.field, message: res.error ?? 'Couldn’t save the item.' });
    });
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setProblem(null);
    const fd = new FormData();
    fd.set('file', file);
    const res = await uploadItemImage(fd);
    setUploading(false);
    if (res.ok && res.url) setImageUrl(res.url);
    else setProblem({ field: 'imageUrl', message: res.error ?? 'The upload failed.' });
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <DialogBody>
        <div className={styles.dialogBody}>
          <div className={cls('name')}>
            <label htmlFor="wi-name">Name</label>
            <input id="wi-name" type="text" aria-invalid={problemFor('name') ? true : undefined} value={name} onChange={(e) => setName(e.target.value)} />
            {note('name')}
          </div>
          <div className={styles.field}>
            <label htmlFor="wi-size">Size</label>
            <input id="wi-size" type="text" value={size} onChange={(e) => setSize(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="wi-desc">Description</label>
            <textarea id="wi-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            <p className={styles.hint}>One honest line: what’s included, what isn’t (a stand, a hanger).</p>
          </div>
          <div className={styles.grid2}>
            <div className={cls('price')}>
              <label htmlFor="wi-price">Price ($)</label>
              <input id="wi-price" type="number" step="0.01" min={0} aria-invalid={problemFor('price') ? true : undefined} value={price} onChange={(e) => setPrice(e.target.value)} />
              {note('price')}
            </div>
            <div className={cls('unitCost')}>
              <label htmlFor="wi-cost">Unit cost ($)</label>
              <input id="wi-cost" type="number" step="0.01" min={0} aria-invalid={problemFor('unitCost') ? true : undefined} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
              {note('unitCost')}
            </div>
          </div>
          <div className={cls('imageUrl')}>
            <label htmlFor="wi-img">Photo address</label>
            <input id="wi-img" type="text" aria-invalid={problemFor('imageUrl') ? true : undefined} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
            {note('imageUrl')}
            <p className={styles.hint}>
              <label className={styles.link}>
                {uploading ? 'Uploading…' : 'Upload a photo instead'}
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
            </p>
          </div>
          <label className={styles.check}>
            <input type="checkbox" checked={donatable} onChange={(e) => setDonatable(e.target.checked)} />
            Can be donated to veterans
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            On sale (uncheck to hide it from the store)
          </label>
          {problem && !problem.field && <Notice variant="error">{problem.message}</Notice>}
        </div>
      </DialogBody>
      <DialogActions>
        <SaveButton dirty={dirty} pending={pending} blocked={keys.length > 0} onBlocked={save} onClick={save} />
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {keys.length > 0 && <SaveProblem reason={p[keys[0]]} more={keys.length - 1} />}
      </DialogActions>
    </form>
  );
}
