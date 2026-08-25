/**
 * Email-safe markdown (Patrick, 2026-08-25: "full markdown style support …
 * the same as is offered in news" for the confirmation emails — option (a):
 * the basics, rendered to inline-styled HTML that Gmail, Apple Mail and Outlook
 * all show the same way, plus a plain-text twin derived from the same source).
 *
 * Supported: `# / ## / ###` headings, paragraphs (blank-line separated),
 * single line breaks inside a paragraph, `- ` / `* ` bullet lists, `1. `
 * numbered lists, `**bold**`, `*italic*` / `_italic_`, `[text](url)` links,
 * bare http(s) URLs (auto-linked), `---` rule. Nothing else — images, tables,
 * HTML and the news editor's {{gallery}}/{{video}} tokens are out of scope for
 * mail. Everything is escaped; only the markup here produces tags.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const P = 'margin:0 0 12px;font-size:15px;line-height:1.55;color:#363636';
const H: Record<number, string> = {
  1: 'font-size:19px;color:#1e3a4a;margin:0 0 12px;line-height:1.3',
  2: 'font-size:17px;color:#1e3a4a;margin:16px 0 8px;line-height:1.3',
  3: 'font-size:15px;color:#1e3a4a;margin:14px 0 6px;line-height:1.3;text-transform:uppercase;letter-spacing:.04em'
};
const UL = 'margin:0 0 12px;padding-left:20px;font-size:15px;line-height:1.55;color:#363636';
const A = 'color:#1e3a4a';

/** Inline markup within one line: links, bold, italic, bare URLs. */
export function inlineHtml(text: string): string {
  let out = '';
  let rest = text;
  // Tokenise links first so their URLs aren't italicised/bolded.
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
  while (rest.length) {
    const m = linkRe.exec(rest);
    if (!m) {
      out += emphasis(rest);
      break;
    }
    out += emphasis(rest.slice(0, m.index));
    out += `<a href="${esc(m[2])}" style="${A}">${esc(m[1])}</a>`;
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

function emphasis(text: string): string {
  // Bare URLs become links; then bold / italic on the escaped remainder.
  const parts = text.split(/(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return `<a href="${esc(part)}" style="${A}">${esc(part)}</a>`;
      return esc(part)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
        .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    })
    .join('');
}

type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'hr' };

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: 'h', level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }
    if (/^-{3,}\s*$/.test(line)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, '').trim());
        i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '').trim());
        i++;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3})\s|^-{3,}\s*$|^\s*[-*]\s+|^\s*\d+[.)]\s+/.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: 'p', lines: para });
  }
  return blocks;
}

/** The body HTML — no wrapper; the caller frames it (renderEmail's shell). */
export function markdownToEmailHtml(md: string): string {
  return parseBlocks(md)
    .map((b) => {
      switch (b.kind) {
        case 'h':
          return `<h${b.level} style="${H[b.level]}">${inlineHtml(b.text)}</h${b.level}>`;
        case 'p':
          return `<p style="${P}">${b.lines.map(inlineHtml).join('<br>')}</p>`;
        case 'ul':
          return `<ul style="${UL}">${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join('')}</ul>`;
        case 'ol':
          return `<ol style="${UL}">${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join('')}</ol>`;
        case 'hr':
          return '<hr style="border:0;border-top:1px solid #e2e4e8;margin:16px 0">';
      }
    })
    .join('\n');
}

function inlineText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, '$1$2');
}

/** The plain-text twin, derived from the same markdown (Patrick: auto). */
export function markdownToEmailText(md: string): string {
  return parseBlocks(md)
    .map((b) => {
      switch (b.kind) {
        case 'h':
          return `${inlineText(b.text).toUpperCase()}`;
        case 'p':
          return b.lines.map(inlineText).join('\n');
        case 'ul':
          return b.items.map((it) => `  - ${inlineText(it)}`).join('\n');
        case 'ol':
          return b.items.map((it, i) => `  ${i + 1}. ${inlineText(it)}`).join('\n');
        case 'hr':
          return '----------';
      }
    })
    .join('\n\n');
}

/** Complete message: the shared shell around the markdown body. */
export function renderMarkdownEmail(opts: { md: string; actionUrl?: string; actionLabel?: string }): { html: string; text: string } {
  const body = markdownToEmailHtml(opts.md);
  const button = opts.actionUrl
    ? `<p style="margin:4px 0 16px"><a href="${esc(opts.actionUrl)}" style="background:#1e3a4a;color:#fff;text-decoration:none;padding:9px 18px;border-radius:3px;display:inline-block">${esc(opts.actionLabel ?? 'Open')}</a></p>`
    : '';
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#363636;max-width:560px">
${body}
${button}<p style="margin:18px 0 0;font-size:12px;color:#787060">Scout Troop 79 · Milwaukee, WI</p>
</div>`;
  const text = [markdownToEmailText(opts.md), ...(opts.actionUrl ? ['', `${opts.actionLabel ?? 'Open'}: ${opts.actionUrl}`] : []), '', 'Scout Troop 79 - Milwaukee, WI'].join('\n');
  return { html, text };
}
