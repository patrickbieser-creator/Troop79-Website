import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import { Children, isValidElement, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react';
import { componentsFor } from './ArticleBody';
import { remarkArticleBlocks } from './remark-article-blocks';
import { remarkSidebarBlocks } from './remark-page-blocks';
import { splitSidebarModules } from './sidebar';
import styles from './page-body.module.css';

/**
 * A content-managed page's sidebar (Plans/Content-Managed-Pages.md). Server-renderable like PageBody, and the
 * same markdown underneath (images, galleries, tables work as in a story) with three conventions on top:
 *   `## Title`              → a sidebar module with that heading
 *   `- **Label** value`     → fact-card rows (the value keeps its links and `\` line breaks)
 *   a paragraph             → a sidebar note
 */

type FactProps = {
  'data-facts'?: string;
  'data-fact'?: string;
  'data-fact-label'?: string;
};

/** Site paths navigate in-app, web addresses open in a new tab, everything else (mailto:) is a plain link. */
export function SmartLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (!href) return <>{children}</>;
  if (href.startsWith('/') && !href.startsWith('//')) return <Link href={href}>{children}</Link>;
  if (/^https?:\/\//i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return <a href={href}>{children}</a>;
}

/** PageBody's and the sidebar's link: SmartLink, except a linked IMAGE keeps ArticleBody's figure handling. */
export function pageAnchor(base: Components) {
  const BaseAnchor = base.a as ElementType;
  return function PageAnchor(props: ComponentPropsWithoutRef<'a'>) {
    const kids = Children.toArray(props.children);
    const wrapsFigure = kids.length === 1 && isValidElement(kids[0]) && kids[0].type === base.img;
    if (wrapsFigure) return <BaseAnchor {...props} />;
    return <SmartLink href={props.href}>{props.children}</SmartLink>;
  };
}

const base = componentsFor(undefined);
const components: Components = {
  ...base,
  ul: ({ children, ...rest }: ComponentPropsWithoutRef<'ul'> & FactProps) =>
    rest['data-facts'] ? <div className={styles.factCard}>{children}</div> : <ul>{children}</ul>,
  li: ({ children, ...rest }: ComponentPropsWithoutRef<'li'> & FactProps) =>
    rest['data-fact'] ? (
      <div className={styles.factRow}>
        <span className={styles.factLabel}>{rest['data-fact-label']}</span>
        <div className={styles.factValue}>{children}</div>
      </div>
    ) : (
      <li>{children}</li>
    ),
  a: pageAnchor(base)
};

export function PageSidebar({ markdown }: { markdown: string }) {
  const modules = splitSidebarModules(markdown);
  return (
    <>
      {modules.map((m, i) => (
        <div key={`${m.title ?? ''}-${i}`} className={styles.sidebarModule}>
          {m.title !== null && <h3 className={styles.sidebarModuleTitle}>{m.title}</h3>}
          <Markdown remarkPlugins={[remarkGfm, remarkArticleBlocks, remarkSidebarBlocks]} components={components}>
            {m.body}
          </Markdown>
        </div>
      ))}
    </>
  );
}
