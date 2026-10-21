'use client';

/**
 * "Invite teachers…" on a wanted topic (Plans/Matcher-Tune-Up.md T-5, P1). The ask-first shortlist, ticked the way
 * it ranks: who answered and who listed the skill are ticked, everyone else who merely qualifies is listed unticked.
 * Opt-in, like the EmailOctopus sync: nothing goes out until the leader presses Send. The action re-decides who may
 * be invited; this only proposes.
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';
import { sendTeachInvitesAction, type SendInvitesResult } from './actions';
import type { CanTeach } from './this-sunday';
import styles from './meeting-plan.module.css';

export function InviteTeachers({ entryId, topicKey, label, people }: { entryId: number; topicKey: string; label: string; people: CanTeach[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState(() => new Set(people.filter((p) => p.tier !== 'other').map((p) => p.personId)));
  const [result, setResult] = useState<SendInvitesResult | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const toggle = (id: number) =>
    setTicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const send = () =>
    start(async () => {
      const res = await sendTeachInvitesAction({ entryId, topicKey, personIds: people.filter((p) => ticked.has(p.personId)).map((p) => p.personId) });
      setResult(res);
      if (res.ok) router.refresh();
    });
  const outcome = (r: SendInvitesResult) =>
    r.ok
      ? [r.sent.length ? `Sent to ${r.sent.join(', ')}.` : 'Nobody was sent an invite.', r.skipped.length ? `Not sent: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}.` : '']
          .filter(Boolean)
          .join(' ')
      : r.error;

  return (
    <>
      <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
        Invite teachers…
      </Button>
      <Dialog ref={ref} aria-label={`Invite teachers: ${label}`} onClose={() => setOpen(false)}>
        <DialogHeader title={`Invite teachers: ${label}`} sub="The Troop 79 Bugler emails each person a link to say yes or not this week. No sign-in needed." />
        <DialogBody>
          <ul className={styles.inviteList}>
            {people.map((p) => (
              <li key={p.personId}>
                <label>
                  <input type="checkbox" aria-label={p.name} checked={ticked.has(p.personId)} disabled={pending || !!result?.ok} onChange={() => toggle(p.personId)} /> {p.name}{' '}
                  <span className={styles.teachMeta}>({p.note})</span>
                </label>
              </li>
            ))}
          </ul>
          {result && (
            <p role="status" className={result.ok ? styles.teachMeta : styles.noTeacher}>
              {outcome(result)}
            </p>
          )}
        </DialogBody>
        <DialogActions>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
            {result?.ok ? 'Close' : 'Cancel'}
          </Button>
          {!result?.ok && (
            <Button variant="primary" size="sm" disabled={pending || ticked.size === 0} onClick={send}>
              {pending ? 'Sending…' : `Send to ${ticked.size}`}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
