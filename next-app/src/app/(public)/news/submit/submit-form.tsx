'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { SubmitResult } from './actions';
import styles from './submit.module.css';

export function SubmitStoryForm({
  authorName,
  onSubmit
}: {
  authorName: string;
  onSubmit: (formData: FormData) => Promise<SubmitResult>;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <div className={styles.done} role="status">
        <h2>Thanks — that&rsquo;s with the leaders now.</h2>
        <p>
          A leader reads every submission before it goes on the site, so it won&rsquo;t appear right
          away. If they publish it, you&rsquo;ll see it on the news page with your name on it.
        </p>
        <p className={styles.doneActions}>
          <Link href="/news">← Back to news</Link>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => {
              setTitle('');
              setBody('');
              setSent(false);
            }}
          >
            Write another
          </button>
        </p>
      </div>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData();
        fd.set('title', title);
        fd.set('body', body);
        startTransition(async () => {
          const res = await onSubmit(fd);
          if (res.ok) setSent(true);
          else setError(res.error ?? 'Something went wrong.');
        });
      }}
    >
      <p className={styles.byline}>
        Submitting as <strong>{authorName}</strong>
      </p>

      <label className={styles.field}>
        <span className={styles.label}>Headline</span>
        <input
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="Winter Camporee, in one word: cold"
          required
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Your story</span>
        <textarea
          className={styles.textarea}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          placeholder="What happened, who was there, and what was the best part?"
          required
        />
        <span className={styles.hint}>
          Write it however you like — a leader will tidy up spelling and add photos before it goes
          up. Don&rsquo;t include anyone&rsquo;s address, phone number or last name.
        </span>
      </label>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.actions}>
        <button type="submit" className={styles.submitBtn} disabled={pending}>
          {pending ? 'Sending…' : 'Send to the leaders'}
        </button>
        <Link href="/news" className={styles.cancel}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
