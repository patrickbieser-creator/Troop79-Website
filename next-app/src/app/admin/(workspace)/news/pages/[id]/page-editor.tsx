'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { SitePage } from '@/lib/site-pages-tree';
import { PageContent } from '@/lib/article-body/PageContent';
import { MarkdownPreview, MarkdownSource, type MarkdownEditorHandle } from '../../../_components/markdown-split-pane';
import { useMarkdownBlockTools } from '../../../_components/markdown-block-tools';
import { Badge } from '../../../_components/badge';
import { PageTitle } from '../../../_components/page-title';
import { ActionsMenu } from '../../../_components/actions-menu';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../../_components/dialog';
import {
  DiscardButton,
  SaveButton,
  SaveFeedback,
  SaveProblem,
  useDraftSnapshot,
  useSavePhase
} from '../../../_components/save-state';
import { Button } from '../../../../_components/button';
import { PublicPageLink } from '../../../../_components/public-page-link';
import { FormSection } from '../../../../_components/form-panel';
import { publishPage, savePage, setPageStatus } from '../actions';
import articleStyles from '../../articles/[id]/article-editor.module.css';
import styles from '../pages.module.css';

interface Props {
  page: SitePage;
  /** The parent page's title, shown with the address; null for a top-level page. */
  parentLabel: string | null;
}

/**
 * The page editor (Plans/Content-Managed-Pages.md): the news article editor's machinery — markdown split pane,
 * block tools, dirty-gated Save + Discard, Saving… → Done — on a page's fields. The left pane is the form
 * (numbered sections, one sticky bar); the right pane previews the page's OWN look (headline, lede, body,
 * sidebar through PageContent) so what you see is what /join shows.
 *
 * Control hierarchy (D-332): one primary at a time — Save while the draft is dirty, Publish when a draft page
 * is saved and clean. The "More actions…" menu holds Take offline, behind a danger Dialog that says what it does.
 */
export function PageEditor({ page, parentLabel }: Props) {
  const router = useRouter();
  const isDraftPage = page.status !== 'published';

  const [title, setTitle] = useState(page.title);
  const [headline, setHeadline] = useState(page.headline);
  const [lede, setLede] = useState(page.lede);
  const [metaDescription, setMetaDescription] = useState(page.meta_description);
  const [body, setBody] = useState(page.body_md);
  const [sidebar, setSidebar] = useState(page.sidebar_md);

  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [pending, startTransition] = useTransition();
  const feedback = useSavePhase();
  const offlineRef = useRef<HTMLDialogElement>(null);

  const draft = { title, headline, lede, metaDescription, body, sidebar };
  const { dirty, markSaved, saved } = useDraftSnapshot(draft);

  const bodyRef = useRef<MarkdownEditorHandle>(null);
  const sidebarRef = useRef<MarkdownEditorHandle>(null);
  const bodyTools = useMarkdownBlockTools(bodyRef);
  const sidebarTools = useMarkdownBlockTools(sidebarRef);

  /** Discard: every field back to the LAST SAVED draft (not what the page loaded with). */
  function discard() {
    setTitle(saved.title);
    setHeadline(saved.headline);
    setLede(saved.lede);
    setMetaDescription(saved.metaDescription);
    setBody(saved.body);
    setSidebar(saved.sidebar);
    setError(null);
    setTried(false);
  }

  const fields = () => ({ title, headline, lede, bodyMd: body, sidebarMd: sidebar, metaDescription });
  const titleMissing = !title.trim();

  function save(thenPublish: boolean) {
    setError(null);
    feedback.start();
    startTransition(async () => {
      if (dirty || !thenPublish) {
        const res = await savePage(page.id, fields());
        if (!res.ok) {
          feedback.fail();
          setError(res.error ?? 'Save failed.');
          return;
        }
        markSaved();
      }
      if (thenPublish) {
        const pub = await publishPage(page.id);
        if (!pub.ok) {
          feedback.fail();
          setError(pub.error ?? 'Publish failed.');
          return;
        }
      }
      feedback.done();
      router.refresh();
    });
  }

  function takeOffline() {
    offlineRef.current?.close();
    setError(null);
    feedback.start();
    startTransition(async () => {
      const res = await setPageStatus(page.id, 'draft');
      if (!res.ok) {
        feedback.fail();
        setError(res.error ?? 'Could not take the page offline.');
        return;
      }
      feedback.done();
      router.refresh();
    });
  }

  return (
    <>
      <PageTitle
        back={{ label: 'Pages', href: '/admin/news/pages' }}
        title={`Edit: ${page.title}`}
        sub="Write in markdown on the left; see how the page will look on the right."
      >
        <PublicPageLink href={page.path} draft={isDraftPage} />
      </PageTitle>

      <div className={articleStyles.editorShell}>
        <div className={`${articleStyles.editorPane} ${styles.editorWrap}`}>
          <div className={articleStyles.editorPaneHead}>
            <h2>Page Details</h2>
            <Badge variant={isDraftPage ? 'warning' : 'success'}>{isDraftPage ? 'Draft' : 'Published'}</Badge>
          </div>

          <FormSection num={1} title="Page">
            <div className={articleStyles.field}>
              <label className="adminLabel" htmlFor="pageTitle">Title</label>
              <input
                id="pageTitle"
                type="text"
                value={title}
                className={tried && titleMissing ? styles.bad : undefined}
                aria-invalid={tried && titleMissing ? true : undefined}
                onChange={(e) => setTitle(e.target.value)}
              />
              {tried && titleMissing ? (
                <div className={styles.badNote}>A title is required.</div>
              ) : (
                <div className={articleStyles.hint}>The name in the admin, and the small label above the headline on the page.</div>
              )}
            </div>
            <div className={articleStyles.field}>
              <label className="adminLabel" htmlFor="pageHeadline">Headline</label>
              <input id="pageHeadline" type="text" value={headline} onChange={(e) => setHeadline(e.target.value)} />
            </div>
            <div className={articleStyles.field}>
              <label className="adminLabel" htmlFor="pageLede">Lede</label>
              <textarea id="pageLede" rows={3} value={lede} onChange={(e) => setLede(e.target.value)} />
              <div className={articleStyles.hint}>The larger intro paragraph under the headline.</div>
            </div>
            <div className={articleStyles.field}>
              <label className="adminLabel" htmlFor="pageMeta">Search description</label>
              <textarea
                id="pageMeta"
                rows={2}
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
              />
              <div className={articleStyles.hint}>Shown under the page name in Google results and link previews.</div>
            </div>
            <div className={articleStyles.field}>
              <span className="adminLabel">Web address</span>
              <div className={styles.addressLine}>
                <code>{page.path}</code>
                {parentLabel && <span className={articleStyles.hint}> — under {parentLabel}</span>}
              </div>
              <div className={articleStyles.hint}>Set when the page was created; it stays put so shared links keep working.</div>
            </div>
          </FormSection>

          <FormSection num={2} title="Body">
            <div className={articleStyles.field}>
              <label className="adminLabel" htmlFor="pageBody">Body</label>
              <MarkdownSource
                id="pageBody"
                ref={bodyRef}
                value={body}
                onChange={setBody}
                textareaClassName={articleStyles.mdTextarea}
                placeholder="Write the page in markdown…"
                ariaLabel="Page body markdown source"
                cheatSheet
                toolbar={bodyTools.toolbar}
              >
                {bodyTools.prompts}
              </MarkdownSource>
              <details className={styles.conventions}>
                <summary>Page blocks</summary>
                <div className={styles.conventionsGrid}>
                  <code>## Heading</code>
                  <span>A section divider</span>
                  <code>1. **Step title** Words…</code>
                  <span>A numbered step (the bold lead is its title)</span>
                  <code>### Question</code>
                  <span>An FAQ entry — the paragraph under it is the answer</span>
                  <code>{'{{cta: Headline | sub | Label->/events | Label->/join}}'}</code>
                  <span>The closing banner; the first button is the bright one</span>
                  <code>{'{{stats: 2022::Founded | ~30::Scouts}}'}</code>
                  <span>A strip of big numbers with labels</span>
                </div>
              </details>
            </div>
          </FormSection>

          <FormSection num={3} title="Sidebar">
            <div className={articleStyles.field}>
              <label className="adminLabel" htmlFor="pageSidebar">Sidebar</label>
              <MarkdownSource
                id="pageSidebar"
                ref={sidebarRef}
                value={sidebar}
                onChange={setSidebar}
                rows={10}
                textareaClassName={articleStyles.mdTextarea}
                placeholder={'## Title\n\n- **Label** Value\n\nA note.'}
                ariaLabel="Page sidebar markdown source"
                toolbar={sidebarTools.toolbar}
              >
                {sidebarTools.prompts}
              </MarkdownSource>
              <div className={articleStyles.hint}>
                Each <code>## Title</code> starts a sidebar box. A list of <code>- **Label** value</code> lines becomes the
                fact card; a paragraph becomes a note.
              </div>
            </div>
          </FormSection>

          {error && <div className={articleStyles.formError}>{error}</div>}

          <div className={styles.stickyBar}>
            <div className={styles.barGroup}>
              <SaveButton
                dirty={dirty}
                pending={pending}
                blocked={titleMissing}
                onBlocked={() => setTried(true)}
                onClick={() => save(false)}
              />
              <DiscardButton dirty={dirty} pending={pending} onClick={discard} />
              {tried && titleMissing && <SaveProblem reason="a title is required" />}
            </div>
            <div className={styles.barGroup}>
              {isDraftPage && (
                // Publish is THE primary once the draft is saved; while there are unsaved edits it stays
                // secondary and saves first (one primary at a time, D-332).
                <Button
                  variant={dirty ? 'secondary' : 'primary'}
                  disabled={pending}
                  onClick={() => (titleMissing ? setTried(true) : save(true))}
                >
                  {dirty ? 'Save & Publish' : 'Publish'}
                </Button>
              )}
              {!isDraftPage && (
                <ActionsMenu
                  ariaLabel="More actions"
                  placeholder="More actions…"
                  disabled={pending}
                  options={[{ value: 'offline', label: 'Take offline…' }]}
                  onAction={(v) => {
                    if (v === 'offline') offlineRef.current?.showModal();
                  }}
                />
              )}
            </div>
          </div>
          <SaveFeedback phase={feedback.phase} />
        </div>

        <MarkdownPreview
          className={articleStyles.previewPane}
          value={[headline, lede, body, sidebar].join('')}
          render={() => (
            <PageContent
              preview
              headline={headline}
              lede={lede}
              bodyMd={body}
              sidebarMd={sidebar}
              onEditBlock={bodyTools.onEditBlock}
            />
          )}
          emptyNote="Nothing written yet — the preview fills in as you type."
        />
      </div>

      <Dialog ref={offlineRef} danger>
        <DialogHeader title="Take this page offline?" />
        <DialogBody>
          <p>
            <strong>{page.path}</strong> will stop showing to visitors — anyone following a link to it gets a
            &ldquo;page not found&rdquo;. You can still edit it and publish it again.
          </p>
        </DialogBody>
        <DialogActions>
          <Button onClick={() => offlineRef.current?.close()}>Cancel</Button>
          <Button variant="dangerSolid" onClick={takeOffline}>
            Take offline
          </Button>
        </DialogActions>
      </Dialog>
      {bodyTools.pickers}
      {sidebarTools.pickers}
    </>
  );
}
