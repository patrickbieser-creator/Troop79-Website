import type { Root, RootContent, List, ListItem, Paragraph, PhrasingContent, Heading } from 'mdast';

/**
 * The page-shaped half of the markdown pipeline (content-managed pages). Runs AFTER remarkArticleBlocks, on the
 * same tree, and only looks at the ROOT's direct children — a list or heading nested inside something else is
 * ordinary markdown. It rewrites structure into marker nodes that PageBody's components turn into the page look:
 *
 *   top-level `1.` list      → data-steps on the <ol>; each item gets data-step + data-step-title (its leading
 *                              **bold**, removed from the body so it is not said twice)
 *   `###` + paragraph(s)     → one <div data-page-block="faq-item"> per pair, consecutive pairs gathered into a
 *                              <div data-page-block="faq">
 *   sidebar: `- **Label** v` → data-facts on the <ul>; each item gets data-fact-label (see markFacts)
 *
 * Unknown mdast node types with children become a plain <div> in mdast-util-to-hast; `data.hName` /
 * `hProperties` is the same override channel remarkArticleBlocks uses for its token blocks.
 */

type Marked = { data?: { hName?: string; hProperties?: Record<string, unknown> } };

function mark<T extends Marked>(node: T, props: Record<string, unknown>): T {
  node.data = { ...node.data, hProperties: { ...node.data?.hProperties, ...props } };
  return node;
}

/** A node remarkArticleBlocks already turned into a token block ({{cta…}}, a gallery…) — never FAQ prose. */
function isBlock(node: RootContent): boolean {
  return (node as Marked).data?.hName !== undefined;
}

function textOf(nodes: PhrasingContent[]): string {
  return nodes
    .map((n) => ('value' in n ? String(n.value) : 'children' in n ? textOf(n.children as PhrasingContent[]) : ''))
    .join('');
}

/**
 * If a list item opens with **bold**, pull it out and return its text; the rest of the item stays. A bold lead
 * followed by a line break or a space is the same thing. Returns null when there is no bold lead.
 */
function takeBoldLead(item: ListItem): string | null {
  const first = item.children[0];
  if (!first || first.type !== 'paragraph') return null;
  const lead = first.children[0];
  if (!lead || lead.type !== 'strong') return null;
  const label = textOf(lead.children).trim();
  first.children.shift();
  const next = first.children[0];
  if (next && next.type === 'text') next.value = next.value.replace(/^\s+/, '');
  if (next && next.type === 'break') first.children.shift();
  if (first.children.length === 0) item.children.shift();
  return label;
}

export function remarkPageBlocks() {
  return (tree: Root) => {
    const out: RootContent[] = [];
    const kids = tree.children;
    for (let i = 0; i < kids.length; i += 1) {
      const node = kids[i];

      if (node.type === 'list' && node.ordered) {
        mark(node as List, { 'data-steps': 'true' });
        for (const item of node.children) {
          const title = takeBoldLead(item);
          mark(item, { 'data-step': 'true', 'data-step-title': title ?? '' });
        }
        out.push(node);
        continue;
      }

      if (node.type === 'heading' && (node as Heading).depth === 3) {
        // Gather consecutive question/answer pairs into one group.
        const items: RootContent[] = [];
        let j = i;
        while (j < kids.length && kids[j].type === 'heading' && (kids[j] as Heading).depth === 3) {
          const answers: Paragraph[] = [];
          let k = j + 1;
          while (k < kids.length && kids[k].type === 'paragraph' && !isBlock(kids[k])) {
            answers.push(kids[k] as Paragraph);
            k += 1;
          }
          if (answers.length === 0) break;
          const item = { type: 'pageBlock', children: [kids[j], ...answers] } as unknown as RootContent;
          items.push(mark(item as unknown as Marked, { 'data-page-block': 'faq-item' }) as unknown as RootContent);
          (item as unknown as Marked).data!.hName = 'div';
          j = k;
        }
        if (items.length > 0) {
          const group = { type: 'pageBlock', children: items } as unknown as RootContent;
          mark(group as unknown as Marked, { 'data-page-block': 'faq' });
          (group as unknown as Marked).data!.hName = 'div';
          out.push(group);
          i = j - 1;
          continue;
        }
      }

      out.push(node);
    }
    tree.children = out;
  };
}

/**
 * The sidebar's one convention: a list whose items all open with **bold** is the fact card (`- **Day** Most
 * Sundays`). Anything else stays markdown (paragraphs are notes).
 */
export function remarkSidebarBlocks() {
  return (tree: Root) => {
    for (const node of tree.children) {
      if (node.type !== 'list' || node.ordered) continue;
      const allLead = node.children.every((item) => {
        const first = item.children[0];
        return first?.type === 'paragraph' && first.children[0]?.type === 'strong';
      });
      if (!allLead) continue;
      mark(node as List, { 'data-facts': 'true' });
      for (const item of node.children) {
        const label = takeBoldLead(item) ?? '';
        mark(item, { 'data-fact': 'true', 'data-fact-label': label });
      }
    }
  };
}
