import { visit } from 'unist-util-visit';
import type { Root, Paragraph } from 'mdast';
import type { VFile } from 'vfile';
import { matchBlockToken } from './tokens';

/**
 * Turns a paragraph whose ENTIRE source text is `{{gallery|gallerylink|video:
 * ...}}` into a `<div data-block-type data-raw>` (see ArticleBody.tsx's
 * ArticleBlockDiv, which dispatches on that marker) via mdast-util-to-hast's
 * `data.hName`/`hProperties` override.
 *
 * Matches against the paragraph's RAW SOURCE SLICE (via its position offsets
 * into the original markdown string), not its parsed children — remark-gfm's
 * autolink-literal extension splits a paragraph containing bare URLs (which
 * every real gallery/video/gallerylink token does) into interleaved
 * text/link nodes, so a "single text child" check never matches real
 * content. This runs on the real parsed AST's source positions, unlike the
 * prototype's demo-only whole-string regex renderer.
 */
export function remarkArticleBlocks() {
  return (tree: Root, file: VFile) => {
    const source = String(file.value);
    visit(tree, 'paragraph', (node: Paragraph) => {
      if (!node.position) return;
      const text = source.slice(node.position.start.offset, node.position.end.offset);
      const match = matchBlockToken(text);
      if (!match) return;

      node.children = [];
      node.data = {
        hName: 'div',
        hProperties: { 'data-block-type': match.type, 'data-raw': match.raw }
      };
    });
  };
}
