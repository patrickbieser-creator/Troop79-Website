import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArticleExcerpt } from '../src/lib/article-body/ArticleExcerpt';
import { excerptPlainText } from '../src/lib/article-body/excerpt-text';

/**
 * A story's excerpt takes the same inline markdown as its body (Patrick,
 * 2026-10-15) so an editor can put a link in it. Where the excerpt sits
 * inside a card that is itself one big link, a nested <a> is invalid HTML
 * (and a hydration error), so there the link keeps its words but drops the
 * anchor — the card already goes to the story.
 */
const MD = 'Sign up on the [wreath page](https://www.troop-79.com/wreaths) by **Oct 25**.';

describe('ArticleExcerpt — links on', () => {
  it('Reader_SeesClickableLink_WhenExcerptHasMarkdownLink', () => {
    render(<ArticleExcerpt text={MD} className="x" />);
    expect(screen.getByRole('link', { name: 'wreath page' }).getAttribute('href')).toBe(
      'https://www.troop-79.com/wreaths'
    );
  });

  it('Reader_SeesBold_WhenExcerptHasStrongMarkdown', () => {
    render(<ArticleExcerpt text={MD} className="x" />);
    expect(screen.getByText('Oct 25').tagName).toBe('STRONG');
  });

  it('Reader_SeesOneParagraph_WithTheGivenClass', () => {
    const { container } = render(<ArticleExcerpt text={MD} className="summary" />);
    const ps = container.querySelectorAll('p');
    expect(ps.length === 1 && ps[0].classList.contains('summary')).toBe(true);
  });

  // The global reset (`a { color: inherit; text-decoration: none }`) left the
  // live link indistinguishable from the prose around it (Patrick, 2026-10-15).
  // The excerpt carries its own prose class that restores the body's link look.
  it('Reader_SeesStyledLink_BecauseExcerptCarriesItsProseClass', () => {
    const { container } = render(<ArticleExcerpt text={MD} className="summary" />);
    const p = container.querySelector('p')!;
    expect([...p.classList].filter((c) => c && c !== 'summary' && c !== 'undefined').length).toBe(1);
  });

  it('Reader_SeesNoImage_WhenExcerptHasImageMarkdown', () => {
    const { container } = render(<ArticleExcerpt text="Look ![x](https://e.com/a.png) here" className="x" />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('Reader_SeesNoScriptLink_WhenHrefIsJavascript', () => {
    render(<ArticleExcerpt text="[bad](javascript:alert(1))" className="x" />);
    expect(screen.queryByRole('link')?.getAttribute('href') ?? '').not.toContain('javascript');
  });

  it('Reader_SeesPlainText_WhenExcerptHasNoMarkdown', () => {
    const { container } = render(<ArticleExcerpt text="A week at Makajawan." className="x" />);
    expect(container.textContent).toBe('A week at Makajawan.');
  });
});

describe('ArticleExcerpt — links off (inside a card link)', () => {
  it('Reader_SeesNoNestedAnchor_WhenLinksOff', () => {
    const { container } = render(<ArticleExcerpt text={MD} className="x" links={false} />);
    expect(container.querySelector('a')).toBeNull();
  });

  it('Reader_StillSeesLinkWords_WhenLinksOff', () => {
    const { container } = render(<ArticleExcerpt text={MD} className="x" links={false} />);
    expect(container.textContent).toBe('Sign up on the wreath page by Oct 25.');
  });
});

describe('excerptPlainText — meta description and JSON-LD', () => {
  it('Search_SeesLinkTextOnly_WhenExcerptHasLink', () => {
    expect(excerptPlainText(MD)).toBe('Sign up on the wreath page by Oct 25.');
  });

  it('Search_SeesNoEmphasisMarks_WhenExcerptHasEmphasis', () => {
    expect(excerptPlainText('A *big* _day_ and `code` and ~~old~~')).toBe('A big day and code and old');
  });

  it('Search_SeesNull_WhenExcerptIsNull', () => {
    expect(excerptPlainText(null)).toBeNull();
  });

  it('Search_SeesSnakeCaseUntouched_WhenUnderscoresAreInsideWords', () => {
    expect(excerptPlainText('see file_name_here')).toBe('see file_name_here');
  });
});
