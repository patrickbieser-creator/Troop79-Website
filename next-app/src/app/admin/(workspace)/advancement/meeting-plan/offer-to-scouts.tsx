'use client';

/**
 * "Offer to scouts…" (Plans/Matcher-Tune-Up.md T-5, P2): a leader offers one requirement to the scouts who could
 * pick it, and the Troop 79 Bugler emails their parents (always) and the scout from 13. Opened on a requested topic,
 * or with no topic from the "Offer a requirement…" picker. Candidates come from the server (who can pick it and isn't
 * out this week); those who haven't picked it are ticked. Opt-in: nothing goes out until Send, and the send re-decides
 * everything.
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';
import { scoutCandidatesAction, sendPickInvitesAction, type ScoutCandidate, type SendInvitesResult } from './actions';
import styles from './meeting-plan.module.css';

export interface OfferChoiceGroup {
  rank: string;
  options: { key: string; label: string }[];
}

export function OfferToScouts({ entryId, topicKey, label, choices }: { entryId: number; topicKey?: string; label?: string; choices?: OfferChoiceGroup[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(topicKey ?? '');
  const [scouts, setScouts] = useState<ScoutCandidate[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<SendInvitesResult | null>(null);
  const [pending, start] = useTransition();
  const title = topicKey ? `Offer to scouts: ${label}` : 'Offer a requirement to scouts';

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const load = (k: string) => {
    setKey(k);
    setScouts(null);
    setProblem(null);
    if (!k) return;
    start(async () => {
      const res = await scoutCandidatesAction({ entryId, topicKey: k });
      if (!res.ok) return setProblem(res.error);
      setScouts(res.scouts);
      setTicked(new Set(res.scouts.filter((s) => s.ticked).map((s) => s.personId)));
    });
  };
  const openDialog = () => {
    setResult(null);
    setOpen(true);
    if (topicKey) load(topicKey);
  };
  const toggle = (id: number) =>
    setTicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const send = () =>
    start(async () => {
      const res = await sendPickInvitesAction({ entryId, topicKey: key, scoutIds: (scouts ?? []).filter((s) => ticked.has(s.personId)).map((s) => s.personId) });
      setResult(res);
      if (res.ok) router.refresh();
    });
  const outcome = (r: SendInvitesResult) =>
    r.ok
      ? [r.sent.length ? `Offered to ${r.sent.join(', ')}.` : 'Nobody was sent an offer.', r.skipped.length ? `Not sent: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}.` : '']
          .filter(Boolean)
          .join(' ')
      : r.error;

  return (
    <>
      <Button variant="quiet" size="sm" onClick={openDialog}>
        {topicKey ? 'Offer to scouts…' : 'Offer a requirement to scouts…'}
      </Button>
      <Dialog ref={ref} aria-label={title} onClose={() => setOpen(false)}>
        <DialogHeader title={title} sub="The Troop 79 Bugler emails each scout’s parents, and the scout from 13. Yes makes it their first pick. No sign-in needed to say yes." />
        <DialogBody>
          {!topicKey && choices && (
            <label className={styles.boardSetting}>
              <span className={styles.teachLabel}>Requirement</span>
              <select className={styles.obSelect} aria-label="Requirement" value={key} disabled={pending || !!result?.ok} onChange={(e) => load(e.target.value)}>
                <option value="">Choose a requirement…</option>
                {choices.map((g) => (
                  <optgroup key={g.rank} label={g.rank}>
                    {g.options.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
          {problem && <p className={styles.noTeacher}>{problem}</p>}
          {key && !scouts && !problem && <p className={styles.teachMeta}>Finding who could work on it…</p>}
          {scouts && scouts.length === 0 && <p className={styles.teachMeta}>No scout can pick this for this meeting.</p>}
          {scouts && scouts.length > 0 && (
            <ul className={styles.inviteList}>
              {scouts.map((s) => (
                <li key={s.personId}>
                  <label>
                    <input type="checkbox" aria-label={s.name} checked={ticked.has(s.personId)} disabled={pending || !!result?.ok} onChange={() => toggle(s.personId)} /> {s.name}{' '}
                    <span className={styles.teachMeta}>({s.note})</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
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
            <Button variant="primary" size="sm" disabled={pending || ticked.size === 0 || !scouts} onClick={send}>
              {pending && scouts ? 'Sending…' : `Send to ${ticked.size}`}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
