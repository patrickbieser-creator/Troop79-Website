'use client';

/**
 * "Will they teach?" in an adult's drawer (Patrick, 2026-11-01: a teacher texts "I'll be there", no time to click): each
 * class they teach on This week, where their answer stands, and They said yes / They said no for a planner to enter it
 * for them. A no asks why (optional), like the email's. Recorded as entered by the planner; their own answer replaces it.
 */
import { useState } from 'react';
import { Button } from '@/app/_components/button';
import { TextInput } from '@/app/_components/form';
import { DECLINE_NOTE_CHARS } from '@/lib/decline-note';
import type { PlanState } from '@/lib/plan-states';
import type { DrawerAsk } from '@/lib/teacher-asks';
import { initialsOf } from '@/lib/meeting-email-log';
import styles from './planner.module.css';

const WORD: Record<PlanState, string> = {
  planned: 'Planned, not asked yet',
  asked: 'Asked, no answer yet',
  confirmed: '✓ Confirmed',
  changed: 'Said yes, plan changed since',
  said_no: 'Said no',
  hidden: 'Can’t make it'
};

export function TheirTeachingAnswers({
  asks,
  busy,
  onAnswer
}: {
  asks: readonly DrawerAsk[];
  busy: boolean;
  onAnswer: (key: string, answer: 'yes' | 'no', note: string | null) => Promise<boolean>;
}) {
  const [noFor, setNoFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  if (!asks.length) return null;
  const saveNo = async (key: string) => {
    if (await onAnswer(key, 'no', note.trim() || null)) {
      setNoFor(null);
      setNote('');
    }
  };
  return (
    <>
      <h3 className={styles.drawerLabel}>Will they teach?</h3>
      <ul className={styles.askList}>
        {asks.map((a) => (
          <li key={a.key} className={styles.ask}>
            <span className={styles.optText}>
              <span className={styles.optTitle}>{a.title}</span>
              <span className={a.state === 'confirmed' ? styles.askYes : styles.optMeta}>
                {WORD[a.state]}
                {a.enteredBy ? ` · entered by ${initialsOf(a.enteredBy)}` : ''}
              </span>
            </span>
            {noFor === a.key ? (
              <span className={styles.askNo}>
                <label className={styles.optMeta}>
                  Why not (optional)
                  <TextInput value={note} maxLength={DECLINE_NOTE_CHARS} onChange={(e) => setNote(e.target.value)} />
                </label>
                <span className={styles.askBtns}>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void saveNo(a.key)}>
                    Save their no
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setNoFor(null)}>
                    Cancel
                  </Button>
                </span>
              </span>
            ) : (
              <span className={styles.askBtns}>
                {a.state === 'confirmed' ? null : (
                  <Button variant="secondary" size="sm" disabled={busy} aria-label={`They said yes to ${a.title}`} onClick={() => void onAnswer(a.key, 'yes', null)}>
                    They said yes
                  </Button>
                )}
                <Button variant="ghost" size="sm" disabled={busy} aria-label={`They said no to ${a.title}`} onClick={() => setNoFor(a.key)}>
                  They said no
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
