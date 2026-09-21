import { describe, it, expect } from 'vitest';
import {
  buildImageMarkdown,
  parseImageMarkdown,
  classifyImageLink,
  type ImageMarkdown
} from '../src/lib/article-body/tokens';

/**
 * The news editor's Insert Image / edit-in-place form (Plans/Article-Image-
 * Flexibility.md step 3) writes and reads plain markdown — `![alt](src
 * "caption")`, wrapped in `[...](href)` when linked. No token: markdown can
 * already say this. The builder and parser must round-trip exactly, or an
 * Edit → Save changes with nothing touched would rewrite the author's text.
 */
const SRC = 'https://troop79.b-cdn.net/flyer.png';

describe('buildImageMarkdown', () => {
  it('Author_GetsPlainImageMarkdown_WhenLinkIsNone', () => {
    expect(buildImageMarkdown({ src: SRC, alt: 'Flyer', caption: null, href: null })).toBe(`![Flyer](${SRC})`);
    expect(buildImageMarkdown({ src: SRC, alt: 'Flyer', caption: 'Sat 9–3', href: null })).toBe(
      `![Flyer](${SRC} "Sat 9–3")`
    );
  });

  it('Author_GetsSelfLinkedMarkdown_WhenFullSizeChosen', () => {
    const md = buildImageMarkdown({ src: SRC, alt: 'Flyer', caption: null, href: SRC });
    expect(md).toBe(`[![Flyer](${SRC})](${SRC})`);
    expect(classifyImageLink(SRC, SRC)).toBe('full');
  });

  it('Author_GetsUrlLinkedMarkdown_WhenUrlChosen', () => {
    expect(buildImageMarkdown({ src: SRC, alt: '', caption: 'Details', href: '/events/23' })).toBe(
      `[![](${SRC} "Details")](/events/23)`
    );
  });

  it('Author_GetsCaptionQuoted_WhenCaptionContainsQuotes', () => {
    const md = buildImageMarkdown({ src: SRC, alt: 'Flyer', caption: 'The "big" sale', href: null });
    expect(md).toBe(`![Flyer](${SRC} "The \\"big\\" sale")`);
    expect(parseImageMarkdown(md)?.caption).toBe('The "big" sale');
  });
});

describe('parseImageMarkdown', () => {
  it('Parser_RoundTripsBuilderOutput_ForAllThreeLinkKinds', () => {
    const cases: ImageMarkdown[] = [
      { src: SRC, alt: 'Flyer', caption: null, href: null },
      { src: SRC, alt: 'Flyer', caption: 'Cap', href: SRC },
      { src: SRC, alt: '', caption: null, href: 'https://example.org/sale' },
      { src: SRC, alt: 'A [b] c', caption: 'x', href: '/events/23' }
    ];
    for (const c of cases) expect(parseImageMarkdown(buildImageMarkdown(c))).toEqual(c);
  });

  it('Parser_ReturnsNull_ForAnythingThatIsNotASingleImage', () => {
    expect(parseImageMarkdown('Just text')).toBeNull();
    expect(parseImageMarkdown('[a link](https://x)')).toBeNull();
    expect(parseImageMarkdown(`![a](${SRC}) and more`)).toBeNull();
    expect(parseImageMarkdown('{{gallery: x::y}}')).toBeNull();
  });

  it('Parser_ToleratesSurroundingWhitespace', () => {
    expect(parseImageMarkdown(`  ![Flyer](${SRC})\n`)).toEqual({ src: SRC, alt: 'Flyer', caption: null, href: null });
  });
});
