import { visit } from 'unist-util-visit';
import type { Root, Paragraph, Image, Link } from 'mdast';
import type { VFile } from 'vfile';
import { matchBlockToken } from './tokens';

/**
 * A paragraph that is exactly one image — bare, or `[![…](…)](href)` — is an
 * editable block too (step 3 of Plans/Article-Image-Flexibility.md). Returns
 * the image node plus the node whose source span the editor must splice:
 * the LINK when the image is linked, so an edit replaces the whole
 * `[![…](…)](…)`, never just the inside.
 */
function standaloneImage(node: Paragraph): { image: Image; span: Image | Link } | null {
  if (node.children.length !== 1) return null;
  const only = node.children[0];
  if (only.type === 'image') return { image: only, span: only };
  if (only.type === 'link' && only.children.length === 1 && only.children[0].type === 'image') {
    return { image: only.children[0], span: only };
  }
  return null;
}

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
      if (!match) {
        const img = standaloneImage(node);
        if (!img || !img.span.position) return;
        const { start, end } = img.span.position;
        img.image.data = {
          ...img.image.data,
          hProperties: {
            ...img.image.data?.hProperties,
            'data-raw': source.slice(start.offset, end.offset),
            'data-start': start.offset,
            'data-end': end.offset
          }
        };
        return;
      }

      node.children = [];
      node.data = {
        hName: 'div',
        hProperties: {
          'data-block-type': match.type,
          'data-raw': match.raw,
          // Source offsets of the whole `{{type: ...}}` paragraph — lets the
          // editor splice an updated token back into the raw body string
          // when a block is edited in place (see ArticleBody's onEditBlock).
          'data-start': node.position.start.offset,
          'data-end': node.position.end.offset
        }
      };
    });
  };
}
