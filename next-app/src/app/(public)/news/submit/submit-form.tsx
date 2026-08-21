'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { SubmitResult } from './actions';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { Field, TextInput, TextArea } from '@/app/_components/form';
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
          <Button
            variant="ghost"
            onClick={() => {
              setTitle('');
              setBody('');
              setSent(false);
            }}
          >
            Write another
          </Button>
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

      <Field label="Headline">
        <TextInput
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="Winter Camporee, in one word: cold"
          required
        />
      </Field>

      <Field
        label="Your story"
        hint={
          <>
            Write it however you like — a leader will tidy up spelling and add photos before it
            goes up. Don&rsquo;t include anyone&rsquo;s address, phone number or last name.
          </>
        }
      >
        <TextArea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          placeholder="What happened, who was there, and what was the best part?"
          required
        />
      </Field>

      {error ? (
        <Notice tone="error" className={styles.errGap}>
          {error}
        </Notice>
      ) : null}

      <div className={styles.actions}>
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Send to the leaders'}
        </Button>
        <Link href="/news" className={styles.cancel}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
