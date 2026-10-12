'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PageTitle } from '../../../_components/page-title';
import { SaveFeedback, useSavePhase } from '../../../_components/save-state';
import { Button } from '../../../../_components/button';
import { FormPanel } from '../../../../_components/form-panel';
import { childPath } from '@/lib/site-pages-tree';
import { slugify } from '@/lib/slugify';
import { createPage } from '../actions';
import styles from '../pages.module.css';

interface ParentOption {
  id: number;
  label: string;
  path: string;
}

/**
 * "+ Page" (Plans/Content-Managed-Pages.md): a title and a place in the tree. The address is made from them
 * (parent path + the title as a slug) and shown before you commit; the page starts as a draft and opens in the
 * editor. A create-once form, so Create is gated on "something typed", not on a saved snapshot.
 */
export function NewPageForm({ parents, initialParentId }: { parents: ParentOption[]; initialParentId: number | null }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState<number | null>(initialParentId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const feedback = useSavePhase();

  const parentPath = parents.find((p) => p.id === parentId)?.path ?? null;
  const preview = title.trim() ? childPath(parentPath, slugify(title)) : null;

  function create() {
    setError(null);
    feedback.start();
    startTransition(async () => {
      const res = await createPage({ title, parentId });
      if (!res.ok || !res.id) {
        feedback.fail();
        setError(res.error ?? 'Could not create the page.');
        return;
      }
      router.push(`/admin/news/pages/${res.id}`);
    });
  }

  return (
    <>
      <PageTitle
        back={{ label: 'Pages', href: '/admin/news/pages' }}
        title="New Page"
        sub="Give it a title and a place in the tree. It starts as a draft, and you write it next."
      />
      <FormPanel>
        <form
          className={styles.newForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create();
          }}
        >
          <div className={styles.field}>
            <label className="adminLabel" htmlFor="newTitle">Title</label>
            <input id="newTitle" type="text" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className="adminLabel" htmlFor="newParent">Under</label>
            <select
              id="newParent"
              value={parentId ?? ''}
              onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">(top level)</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {preview && (
              <div className={styles.hint}>
                Address: <code>{preview}</code>
              </div>
            )}
          </div>
          <div className={styles.formActions}>
            <Button variant="primary" type="submit" disabled={pending || !title.trim()} title={title.trim() ? undefined : 'Type a title first'}>
              {pending ? 'Creating…' : 'Create page'}
            </Button>
            <Button href="/admin/news/pages">Cancel</Button>
          </div>
          {error && <div className={styles.formError} role="alert">{error}</div>}
        </form>
      </FormPanel>
      <SaveFeedback phase={feedback.phase} savingLabel="Creating page…" doneLabel="Page created." />
    </>
  );
}
