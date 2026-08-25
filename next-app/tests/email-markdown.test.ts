import { describe, it, expect } from 'vitest';
import { markdownToEmailHtml, markdownToEmailText, renderMarkdownEmail } from '../src/lib/email-markdown';

/**
 * Email-safe markdown (Patrick, 2026-08-25: option (a) — the basics, inline
 * styles, a plain-text twin derived from the same source).
 */
describe('email markdown', () => {
  it('RendersHeadingsParagraphsListsEmphasisAndLinks_WithInlineStyles', () => {
    const html = markdownToEmailHtml('# Hello\n\nHi **Dana**, see *you* there.\nSecond line.\n\n- Avery\n- Blake\n\n1. First\n2. Second\n\n[Open in Google Maps](https://maps.example/x)');
    expect(html).toContain('<h1 style=');
    expect(html).toContain('Hi <strong>Dana</strong>, see <em>you</em> there.<br>Second line.');
    expect(html).toContain('<ul style=');
    expect(html).toContain('<li>Avery</li><li>Blake</li>');
    expect(html).toContain('<ol style=');
    expect(html).toContain('<a href="https://maps.example/x" style="color:#1e3a4a">Open in Google Maps</a>');
  });

  it('EscapesHtml_AndAutoLinksBareUrls', () => {
    const html = markdownToEmailHtml('<script>alert(1)</script> at https://www.troop-79.com/events/7.');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<a href="https://www.troop-79.com/events/7" style="color:#1e3a4a">https://www.troop-79.com/events/7</a>.');
  });

  it('PlainTextTwin_KeepsTheStructure_WithoutMarkup', () => {
    const text = markdownToEmailText('## Who\n\nHi **Dana**.\n\n- Avery\n- Blake\n\n[Map](https://m.example/1)');
    expect(text).toBe('WHO\n\nHi Dana.\n\n  - Avery\n  - Blake\n\nMap (https://m.example/1)');
  });

  it('RenderMarkdownEmail_WrapsBodyWithTheActionButtonAndSignature', () => {
    const { html, text } = renderMarkdownEmail({ md: 'Hi.', actionUrl: 'https://x/events/7', actionLabel: 'Open event' });
    expect(html).toContain('Open event</a>');
    expect(html).toContain('Scout Troop 79');
    expect(text).toContain('Open event: https://x/events/7');
  });
});
