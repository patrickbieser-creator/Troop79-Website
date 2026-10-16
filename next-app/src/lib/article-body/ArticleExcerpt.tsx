import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ComponentPropsWithoutRef } from 'react';

/**
 * Renders a story's excerpt — the same markdown dialect as the body, cut
 * down to inline marks (links, bold, italic, strikethrough, code) so a
 * summary can carry a link (Patrick, 2026-10-15) without growing headings,
 * lists or images on a card. Paragraphs are flattened into the ONE `<p>`
 * the caller styles; raw HTML is never rendered and react-markdown's URL
 * filter drops `javascript:` hrefs.
 *
 * `links={false}` is for an excerpt inside a card that is already one big
 * `<Link>`: a nested `<a>` is invalid HTML and a hydration error, so the
 * link keeps its words and loses its anchor (the card goes to the story).
 */
const ALLOWED = ['p', 'a', 'strong', 'em', 'del', 'code'];

const Paragraph = ({ children }: ComponentPropsWithoutRef<'p'>) => <>{children}</>;
const LinkWords = ({ children }: ComponentPropsWithoutRef<'a'>) => <>{children}</>;

const withLinks: Components = { p: Paragraph };
const withoutLinks: Components = { p: Paragraph, a: LinkWords };

export function ArticleExcerpt({
  text,
  className,
  links = true
}: {
  text: string;
  className: string;
  links?: boolean;
}) {
  return (
    <p className={className}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        allowedElements={ALLOWED}
        unwrapDisallowed
        components={links ? withLinks : withoutLinks}
      >
        {text}
      </Markdown>
    </p>
  );
}
