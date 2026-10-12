import type { EditableBlockInfo } from './ArticleBody';
import { PageBody } from './PageBody';
import { PageSidebar } from './PageSidebar';
import styles from './page-body.module.css';

/**
 * The whole content area of a managed page: headline, lede, body, sidebar. The public route wraps it in the
 * site's section header bar; the admin editor's live preview renders it `preview` — a single narrow column
 * (sidebar under the page) with the headline as a plain block, since the admin screen owns the real <h1>.
 */
export function PageContent({
  headline,
  lede,
  bodyMd,
  sidebarMd,
  preview = false,
  onEditBlock
}: {
  headline: string;
  lede: string;
  bodyMd: string;
  sidebarMd: string;
  preview?: boolean;
  onEditBlock?: (info: EditableBlockInfo) => void;
}) {
  const Headline = preview ? 'div' : 'h1';
  return (
    <div className={`${styles.layout} ${preview ? styles.stack : ''}`}>
      <div className={styles.main}>
        {headline && <Headline className={styles.pageHeadline}>{headline}</Headline>}
        {lede && <p className={styles.lede}>{lede}</p>}
        <PageBody body={bodyMd} onEditBlock={onEditBlock} />
      </div>
      {sidebarMd.trim() && (
        <aside className={styles.sidebar}>
          <PageSidebar markdown={sidebarMd} />
        </aside>
      )}
    </div>
  );
}
