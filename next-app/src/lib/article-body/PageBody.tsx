import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ComponentPropsWithoutRef, ElementType } from 'react';
import { SectionDivider } from '@/app/_components/section-divider';
import { componentsFor, type EditableBlockInfo } from './ArticleBody';
import { remarkArticleBlocks } from './remark-article-blocks';
import { remarkPageBlocks } from './remark-page-blocks';
import { pageAnchor } from './PageSidebar';
import styles from './page-body.module.css';

/**
 * Renders a content-managed page's main column (Plans/Content-Managed-Pages.md): ArticleBody's page-shaped
 * sibling. SAME remark pipeline (GFM + the {{…}} token blocks) plus remark-page-blocks, and page components on
 * top of ArticleBody's own — so images, galleries and tables behave exactly as they do in a story.
 *
 * The conventions an editor writes against:
 *   ## Heading                       a section divider
 *   1. **Step title**  body text     a numbered step (top-level ordered lists only)
 *   ### Question  + a paragraph      an FAQ entry
 *   {{cta: Headline | sub | Label->/href | Label->/href}}   closing banner
 *   {{stats: 2022::Founded | ~30::Scouts}}                   stat strip
 *
 * No 'use client': renders as a Server Component on the public page and inside the editor's live preview.
 */
export function PageBody({
  body,
  onEditBlock
}: {
  body: string;
  onEditBlock?: (info: EditableBlockInfo) => void;
}) {
  return (
    <div className={styles.pageBody}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkArticleBlocks, remarkPageBlocks]}
        components={pageComponentsFor(onEditBlock)}
      >
        {body}
      </Markdown>
    </div>
  );
}

type Handler = (info: EditableBlockInfo) => void;

/** Cached per handler for the same reason ArticleBody caches: new component types remount every image. */
const sets = new WeakMap<Handler, Components>();
let publicSet: Components | undefined;

function pageComponentsFor(onEditBlock?: Handler): Components {
  if (!onEditBlock) return (publicSet ??= build(undefined));
  let set = sets.get(onEditBlock);
  if (!set) {
    set = build(onEditBlock);
    sets.set(onEditBlock, set);
  }
  return set;
}

type StepProps = {
  'data-steps'?: string;
  'data-step'?: string;
  'data-step-title'?: string;
  'data-page-block'?: string;
};

function build(onEditBlock: Handler | undefined): Components {
  const base = componentsFor(onEditBlock);
  const BaseDiv = base.div as ElementType;

  return {
    ...base,
    h2: ({ children }) => (
      <div role="heading" aria-level={2} className={styles.sectionBreak}>
        <SectionDivider label={children} />
      </div>
    ),
    ol: ({ children, start, ...rest }: ComponentPropsWithoutRef<'ol'> & StepProps) =>
      rest['data-steps'] ? <ol className={styles.steps}>{children}</ol> : <ol start={start}>{children}</ol>,
    li: ({ children, ...rest }: ComponentPropsWithoutRef<'li'> & StepProps) =>
      rest['data-step'] ? (
        <li className={styles.step}>
          <span className={styles.stepNum} aria-hidden="true" />
          <div>
            {rest['data-step-title'] && <h3 className={styles.stepTitle}>{rest['data-step-title']}</h3>}
            <div className={styles.stepBody}>{children}</div>
          </div>
        </li>
      ) : (
        <li>{children}</li>
      ),
    div: (props: ComponentPropsWithoutRef<'div'> & StepProps) => {
      const kind = props['data-page-block'];
      if (kind === 'faq') return <div className={styles.faq}>{props.children}</div>;
      if (kind === 'faq-item') return <div className={styles.faqItem}>{props.children}</div>;
      return <BaseDiv {...props} />;
    },
    // Site paths navigate in-app and web addresses open in a new tab (the old /join maps link did); a linked
    // IMAGE keeps ArticleBody's figure handling.
    a: pageAnchor(base)
  };
}
