'use client';

/**
 * Wreath sale › Sellers: who sells and what their link is. A seller is an active scout on the roster; their link is
 * /wreaths/<first-name-last-initial>. Customers see first name + last initial only. A retired seller keeps the link
 * but it opens the general store (nothing says they ever sold); a cleared link means no personal page. A new link
 * that collides with another is refused — there is no auto-suffix.
 */

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '../../../_components/button';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';
import { Badge } from '../../_components/badge';
import { SaveButton, SaveProblem, useSavedSnapshot } from '../../_components/save-state';
import type { AdminSeller } from '@/lib/wreaths/admin-data';
import { addSeller, setSellerActive, setSellerDeliveryMessage, setSellerGoal, setSellerSlug } from './actions';
import styles from './wreaths.module.css';

interface Candidate {
  personId: number;
  name: string;
  firstName: string;
  lastName: string;
}

const suggest = (c: Candidate) => {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${clean(c.firstName)}-${clean(c.lastName).slice(0, 1)}`;
};

export function SellersPanel({ saleId, sellers, candidates }: { saleId: number; sellers: AdminSeller[]; candidates: Candidate[] }) {
  const [editing, setEditing] = useState<AdminSeller | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDialogElement>(null);

  function toggle(s: AdminSeller) {
    setRowError(null);
    start(async () => {
      const res = await setSellerActive(s.id, !s.active);
      if (!res.ok) setRowError({ id: s.id, message: res.error ?? 'Couldn’t save that.' });
    });
  }

  return (
    <>
      <p className={styles.note}>
        A seller’s link is troop-79.com/wreaths/&lt;link&gt;. Customers see first name and last initial only. A retired seller’s link, or a cleared one, opens the general store.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Scout</th>
              <th>Link</th>
              <th className={styles.numCell}>Orders</th>
              <th className={styles.numCell}>Goal</th>
              <th>Status</th>
              <th className={styles.actionsCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sellers.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className={styles.mono}>
                  {s.slug ? (
                    <Link className={styles.link} href={`/wreaths/${s.slug}`}>
                      /wreaths/{s.slug}
                    </Link>
                  ) : (
                    <span className={styles.muted}>No link</span>
                  )}
                </td>
                <td className={styles.numCell}>{s.orders}</td>
                <td className={styles.numCell}>{s.goal ? s.goal : <span className={styles.muted}>None</span>}</td>
                <td>{s.active ? <Badge variant="success">Selling</Badge> : <Badge variant="muted">Retired</Badge>}</td>
                <td className={styles.actionsCell}>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Edit ${s.name}`}
                    onClick={() => {
                      setEditing(s);
                      requestAnimationFrame(() => ref.current?.showModal());
                    }}
                  >
                    Edit
                  </Button>{' '}
                  <Button variant="quiet" size="sm" disabled={pending} aria-label={`${s.active ? 'Retire' : 'Restore'} ${s.name}`} onClick={() => toggle(s)}>
                    {s.active ? 'Retire' : 'Restore'}
                  </Button>
                  {rowError?.id === s.id && <div className={styles.badNote}>{rowError.message}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddSeller saleId={saleId} candidates={candidates} />

      <Dialog ref={ref} onClose={() => setEditing(null)}>
        <DialogHeader title={editing ? `Edit ${editing.name}` : 'Edit seller'} />
        {editing && <SlugForm key={editing.id} seller={editing} onClose={() => ref.current?.close()} />}
      </Dialog>
    </>
  );
}

function AddSeller({ saleId, candidates }: { saleId: number; candidates: Candidate[] }) {
  const [personId, setPersonId] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();

  const p: Record<string, string> = {};
  if (tried) {
    if (!personId) p.personId = 'Choose a scout.';
    if (!slug.trim()) p.slug = 'Give the seller a link, like oliver-k.';
  }
  const problemFor = (k: string) => p[k] ?? (problem?.field === k ? problem.message : undefined);
  const keys = Object.keys(p);
  const cls = (k: string) => `${styles.field} ${problemFor(k) ? styles.bad : ''}`;

  function choose(id: string) {
    setPersonId(id);
    const c = candidates.find((x) => String(x.personId) === id);
    if (c && !slugTouched) setSlug(suggest(c));
  }

  function add() {
    setTried(true);
    setProblem(null);
    if (!personId || !slug.trim()) return;
    start(async () => {
      const res = await addSeller(saleId, { personId: Number(personId), slug });
      if (res.ok) {
        setPersonId('');
        setSlug('');
        setSlugTouched(false);
        setTried(false);
      } else setProblem({ field: res.field, message: res.error ?? 'Couldn’t add the seller.' });
    });
  }

  return (
    <form
      className={styles.addPanel}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <h3 className={styles.fieldLabel}>Add a seller</h3>
      <div className={cls('personId')}>
        <label htmlFor="ws-person">Scout</label>
        <select id="ws-person" aria-invalid={problemFor('personId') ? true : undefined} value={personId} onChange={(e) => choose(e.target.value)}>
          <option value="">Choose a scout…</option>
          {candidates.map((c) => (
            <option key={c.personId} value={c.personId}>
              {c.name}
            </option>
          ))}
        </select>
        {problemFor('personId') && <p className={styles.badNote}>{problemFor('personId')}</p>}
        <p className={styles.hint}>
          Not listed? Only active scouts on the roster can sell. <Link className={styles.link} href="/admin/advancement/roster">Add them to the roster</Link> first.
        </p>
      </div>
      <div className={cls('slug')}>
        <label htmlFor="ws-slug">Link</label>
        <input
          id="ws-slug"
          type="text"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={problemFor('slug') ? true : undefined}
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
        />
        {problemFor('slug') && <p className={styles.badNote}>{problemFor('slug')}</p>}
        <p className={styles.hint}>First name and last initial, like oliver-k. Lowercase letters, numbers and hyphens.</p>
      </div>
      <div className={styles.dialogActions}>
        <SaveButton isNew newLabel="Add seller" dirty={false} pending={pending} blocked={keys.length > 0} onBlocked={add} onClick={add} />
        {keys.length > 0 && <SaveProblem reason={p[keys[0]]} more={keys.length - 1} />}
        {keys.length === 0 && problem && !problem.field && <SaveProblem reason={problem.message} />}
      </div>
    </form>
  );
}

function SlugForm({ seller, onClose }: { seller: AdminSeller; onClose: () => void }) {
  const [slug, setSlug] = useState(seller.slug ?? '');
  const [goal, setGoal] = useState(seller.goal == null ? '' : String(seller.goal));
  const [message, setMessage] = useState(seller.deliveryMessage ?? '');
  const [problem, setProblem] = useState<{ field: 'slug' | 'goal' | 'deliveryMessage'; message: string } | null>(null);
  const [pending, start] = useTransition();
  const { dirty } = useSavedSnapshot(JSON.stringify({ slug, goal, message }));

  function save() {
    setProblem(null);
    start(async () => {
      if (slug.trim() !== (seller.slug ?? '')) {
        const res = await setSellerSlug(seller.id, slug.trim() || null);
        if (!res.ok) return setProblem({ field: 'slug', message: res.error ?? 'Couldn’t save the link.' });
      }
      if (goal.trim() !== (seller.goal == null ? '' : String(seller.goal))) {
        const res = await setSellerGoal(seller.id, goal);
        if (!res.ok) return setProblem({ field: 'goal', message: res.error ?? 'Couldn’t save the goal.' });
      }
      if (message.trim() !== (seller.deliveryMessage ?? '')) {
        const res = await setSellerDeliveryMessage(seller.id, message);
        if (!res.ok) return setProblem({ field: 'deliveryMessage', message: res.error ?? 'Couldn’t save the message.' });
      }
      onClose();
    });
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
        <div className={`${styles.field} ${problem?.field === 'slug' ? styles.bad : ''}`}>
          <label htmlFor="ws-edit-slug">Link</label>
          <input id="ws-edit-slug" type="text" autoComplete="off" spellCheck={false} aria-invalid={problem?.field === 'slug' ? true : undefined} value={slug} onChange={(e) => setSlug(e.target.value)} />
          {problem?.field === 'slug' && <p className={styles.badNote}>{problem.message}</p>}
          <p className={styles.hint}>Leave it empty to give this seller no personal page. Changing a link breaks the one already shared.</p>
        </div>
        <div className={`${styles.field} ${problem?.field === 'goal' ? styles.bad : ''}`}>
          <label htmlFor="ws-edit-goal">Goal (wreaths)</label>
          <input id="ws-edit-goal" type="text" inputMode="numeric" autoComplete="off" aria-invalid={problem?.field === 'goal' ? true : undefined} value={goal} onChange={(e) => setGoal(e.target.value)} />
          {problem?.field === 'goal' && <p className={styles.badNote}>{problem.message}</p>}
          <p className={styles.hint}>A whole number from 0 to 999. Leave it empty for no goal. The scout’s family can set this too.</p>
        </div>
        <div className={`${styles.field} ${problem?.field === 'deliveryMessage' ? styles.bad : ''}`}>
          <label htmlFor="ws-edit-msg">Delivery message</label>
          <input id="ws-edit-msg" type="text" maxLength={200} autoComplete="off" aria-invalid={problem?.field === 'deliveryMessage' ? true : undefined} value={message} onChange={(e) => setMessage(e.target.value)} />
          {problem?.field === 'deliveryMessage' && <p className={styles.badNote}>{problem.message}</p>}
          <p className={styles.hint}>Replaces “delivers your order in person…” on the scout’s page. Live when saved. Leave it empty for the standard line.</p>
        </div>
      </DialogBody>
      <DialogActions>
        <SaveButton dirty={dirty} pending={pending} onClick={save} />
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </DialogActions>
    </form>
  );
}
