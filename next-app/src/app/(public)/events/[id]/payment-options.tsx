'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PAY_CHOICE_LABEL,
  SCOUT_ACCOUNT_FUNDING_NOTE,
  cardTotalFor,
  offeredChoices,
  payHowTo,
  payMoney,
  type PayChoice,
  type PayTo
} from '@/lib/event-pay/options';
import styles from './event-detail.module.css';

export interface ScoutAccountOption {
  personId: number;
  name: string;
  balance: number;
}

/** The short line under each method's name, visible whether or not it is chosen. */
function subLine(c: PayChoice, payTo: PayTo, due: number, scouts: ScoutAccountOption[]): string {
  switch (c) {
    case 'venmo':
      return payTo.venmoHandle;
    case 'paypal':
      return payTo.paypalEmail;
    case 'check':
      return `Payable to ${payTo.checkPayableTo}`;
    case 'cash':
      return 'At any meeting';
    case 'scout_account':
      return scouts.map((s) => `${s.name.split(' ')[0]}: ${payMoney(s.balance)} available`).join(' · ');
    case 'card':
      return due > 0 ? `Adds a ${payMoney(cardTotalFor(due).fee)} card fee` : 'Adds a card fee of about 3%';
  }
}

/**
 * "How will you pay?" on the family sign-up form: one row per method, the chosen one opened with what to do
 * (Patrick, 2026-11-13: options instead of one long sentence). A scout account is always listed, with its balance,
 * even at $0. The choice is a request the treasurer sees; only a card payment happens on the site.
 */
export function PaymentOptions({
  payTo,
  cardLive,
  due,
  scouts,
  value,
  onChange,
  payFrom,
  onPayFrom
}: {
  payTo: PayTo;
  cardLive: boolean;
  /** What is still owed, in dollars. */
  due: number;
  scouts: ScoutAccountOption[];
  value: PayChoice | null;
  onChange: (c: PayChoice) => void;
  payFrom: number | null;
  onPayFrom: (personId: number) => void;
}) {
  const choices = offeredChoices(payTo, { cardLive, hasScoutAccount: scouts.length > 0 });
  const fromScout = scouts.find((s) => s.personId === payFrom) ?? scouts[0] ?? null;

  return (
    <fieldset className={styles.payOptions}>
      <legend className={styles.payLegend}>How will you pay?</legend>
      {choices.map((c) => {
        const on = value === c;
        const amount = c === 'card' && due > 0 ? cardTotalFor(due).total : due;
        return (
          <div key={c} className={`${styles.payOpt} ${on ? styles.payOptOn : ''}`}>
            <label className={styles.payOptHead}>
              <input type="radio" name="payMethodChoice" value={c} checked={on} onChange={() => onChange(c)} />
              <span className={styles.payOptName}>
                {PAY_CHOICE_LABEL[c]}
                <span className={styles.payOptSub}>{subLine(c, payTo, due, scouts)}</span>
              </span>
              <span className={styles.payOptAmt}>{payMoney(amount)}</span>
            </label>
            {on && (
              <div className={styles.payOptDetail}>
                {c === 'scout_account' && scouts.length > 1 && (
                  <label className={styles.payFrom}>
                    From whose account?{' '}
                    <select value={fromScout?.personId ?? ''} onChange={(e) => onPayFrom(Number(e.target.value))}>
                      {scouts.map((s) => (
                        <option key={s.personId} value={s.personId}>
                          {s.name} ({payMoney(s.balance)})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p>{payHowTo(c, payTo, due, c === 'scout_account' ? fromScout : null)}</p>
                {c === 'venmo' && payTo.venmoUrl && (
                  <p>
                    <a href={payTo.venmoUrl} target="_blank" rel="noopener noreferrer">
                      Open Venmo
                    </a>
                  </p>
                )}
                {c === 'card' && <p>You go to the card page when you press the button below.</p>}
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

/** Back from Stripe before the webhook landed: re-render every few seconds until the payment shows (a minute at
 *  most; Stripe's own receipt email is already on its way). */
export function CardReturnRefresh() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= 20) return;
    const t = setTimeout(() => {
      router.refresh();
      setTries((n) => n + 1);
    }, 3000);
    return () => clearTimeout(t);
  }, [tries, router]);
  return tries >= 20 ? <span> This is taking longer than usual. Stripe emails your receipt; this page will show the payment shortly.</span> : null;
}

/** The same methods as plain reading on the public event page: no balances, nothing to choose. */
export function PaymentMethodsList({ payTo, cardLive }: { payTo: PayTo; cardLive: boolean }) {
  const choices = offeredChoices(payTo, { cardLive, hasScoutAccount: true });
  return (
    <ul className={styles.payMethods}>
      {choices.map((c) => (
        <li key={c}>
          <strong>{PAY_CHOICE_LABEL[c]}</strong>
          <span>
            {c === 'venmo' && `${payTo.venmoHandle}${payTo.venmoHint ? ` (${payTo.venmoHint})` : ''}`}
            {c === 'paypal' && payTo.paypalEmail}
            {c === 'check' && `Payable to ${payTo.checkPayableTo}. Bring it to any meeting${payTo.checkMailTo ? `, or mail it to ${payTo.checkMailTo}` : ''}.`}
            {c === 'cash' && 'Bring it to any meeting.'}
            {c === 'scout_account' && `Choose it when you sign up. ${SCOUT_ACCOUNT_FUNDING_NOTE}`}
            {c === 'card' && 'Card, Apple Pay or Google Pay when you sign up. Adds a card fee of about 3%.'}
          </span>
        </li>
      ))}
    </ul>
  );
}
