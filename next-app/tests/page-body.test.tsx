import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PageBody } from '../src/lib/article-body/PageBody';
import { PageSidebar } from '../src/lib/article-body/PageSidebar';
import { splitSidebarModules } from '../src/lib/article-body/sidebar';
import { parseCtaToken, parseStatsToken, matchBlockToken } from '../src/lib/article-body/tokens';

/**
 * Content-managed pages (Plans/Content-Managed-Pages.md): PageBody is ArticleBody's page-shaped sibling. The
 * markdown CONVENTIONS are the contract Patrick edits against, so each one is pinned here:
 *   ##            → section divider
 *   1. **Title**  → numbered step (top-level ordered list only)
 *   ### + para    → FAQ question + answer
 *   {{cta: …}}    → closing banner;  {{stats: …}} → stat strip
 *   sidebar       → `## ` modules; `- **Label** value` → fact rows; paragraphs → notes
 */

describe('PageBody — sections', () => {
  it('PageBody_RendersH2_AsSectionDivider', () => {
    const { container } = render(<PageBody body={'## How Joining Works\n\nSome words.'} />);
    // An h2 in the markdown is a labelled divider, not a bare <h2>: a heading-role div carrying the label.
    const heading = screen.getByRole('heading', { level: 2, name: 'How Joining Works' });
    expect(heading.tagName).toBe('DIV');
    expect(container.querySelector('h2')).toBeNull();
    expect(screen.getByText('Some words.')).toBeTruthy();
  });
});

describe('PageBody — numbered steps', () => {
  const steps = [
    '1. **Visit a Sunday meeting**',
    '   We meet most Sundays at [Northwoods](https://example.org/map).',
    '2. **Say hello** Email the troop and a real parent will answer.'
  ].join('\n');

  it('PageBody_RendersTopLevelOrderedList_AsNumberedSteps_WithBoldLeadAsTitle', () => {
    const { container } = render(<PageBody body={steps} />);
    const items = container.querySelectorAll('ol > li');
    expect(items).toHaveLength(2);

    // The bold lead becomes the step's title heading — on its own line OR run into the sentence.
    const first = screen.getByRole('heading', { level: 3, name: 'Visit a Sunday meeting' });
    expect(items[0].contains(first)).toBe(true);
    expect(screen.getByRole('heading', { level: 3, name: 'Say hello' })).toBeTruthy();

    // …and it is NOT repeated in the body text, which keeps its inline link.
    expect(within(items[0] as HTMLElement).getAllByText(/Visit a Sunday meeting/)).toHaveLength(1);
    expect(within(items[0] as HTMLElement).getByRole('link', { name: 'Northwoods' }).getAttribute('href')).toBe(
      'https://example.org/map'
    );
    expect(within(items[1] as HTMLElement).getByText(/Email the troop and a real parent will answer\./)).toBeTruthy();
  });

  it('PageBody_LeavesNestedAndBulletLists_AsOrdinaryLists', () => {
    const { container } = render(<PageBody body={'- one\n- two\n\nText\n\n- a\n  1. nested\n  2. nested too'} />);
    expect(container.querySelectorAll('ul')).toHaveLength(2);
    // A step heading appears only for top-level ordered lists.
    expect(container.querySelectorAll('h3')).toHaveLength(0);
  });
});

describe('PageBody — FAQ', () => {
  it('PageBody_RendersH3PlusParagraph_AsFaqQuestionAndAnswer', () => {
    const { container } = render(
      <PageBody
        body={['### What does it cost?', 'There is an annual fee.', '', '### Can parents stay?', 'Yes — we’re a family troop.'].join('\n')}
      />
    );
    const q = screen.getByRole('heading', { level: 3, name: 'What does it cost?' });
    // The answer is the question's next sibling, and the pair shares one wrapper — one FAQ item.
    expect(q.nextElementSibling?.textContent).toBe('There is an annual fee.');
    expect(q.parentElement?.children).toHaveLength(2);
    const second = screen.getByRole('heading', { level: 3, name: 'Can parents stay?' });
    expect(second.parentElement).not.toBe(q.parentElement);
    // Both items sit in one FAQ group.
    expect(second.parentElement?.parentElement).toBe(q.parentElement?.parentElement);
    expect(container.querySelectorAll('h3')).toHaveLength(2);
  });
});

describe('cta token', () => {
  const RAW = 'Come say hi this Sunday. | 4:00 PM at Northwoods — or send a note. | Email the Troop->mailto:troop@example.org | Check the Calendar->/events';

  it('CtaToken_ParsesHeadlineSubAndButtons', () => {
    expect(parseCtaToken(RAW)).toEqual({
      headline: 'Come say hi this Sunday.',
      sub: '4:00 PM at Northwoods — or send a note.',
      buttons: [
        { label: 'Email the Troop', href: 'mailto:troop@example.org' },
        { label: 'Check the Calendar', href: '/events' }
      ]
    });
    // Headline alone is valid; a button with no arrow is ignored rather than rendered dead.
    expect(parseCtaToken('Just a headline')).toEqual({ headline: 'Just a headline', sub: '', buttons: [] });
    expect(parseCtaToken('H | S | no arrow here').buttons).toEqual([]);
    expect(matchBlockToken(`{{cta: ${RAW}}}`)?.type).toBe('cta');
  });

  // qa-lead W1: the CTA skips react-markdown's URL sanitising, so the parser allows only a site path, http(s) and mailto.
  it('CtaToken_DropsAButton_WhoseLinkIsNotASitePathWebOrMailto', () => {
    const hrefs = parseCtaToken('H | S | A->javascript:alert(1) | B->data:text/html,x | C->//evil.example | D->https://scouting.org | E->/join').buttons.map((b) => b.href);
    expect(hrefs).toEqual(['https://scouting.org', '/join']);
  });

  it('CtaToken_RendersBanner', () => {
    render(<PageBody body={`Intro.\n\n{{cta: ${RAW}}}`} />);
    expect(screen.getByText('Come say hi this Sunday.')).toBeTruthy();
    expect(screen.getByText('4:00 PM at Northwoods — or send a note.')).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Email the Troop', 'mailto:troop@example.org'],
      ['Check the Calendar', '/events']
    ]);
  });
});

describe('stats token', () => {
  const RAW = '2022::Founded | ~30::Scouts | 25::Families | 10::Adult Leaders';

  it('StatsToken_ParsesValueLabelPairs', () => {
    expect(parseStatsToken(RAW)).toEqual([
      { value: '2022', label: 'Founded' },
      { value: '~30', label: 'Scouts' },
      { value: '25', label: 'Families' },
      { value: '10', label: 'Adult Leaders' }
    ]);
    expect(matchBlockToken(`{{stats: ${RAW}}}`)?.type).toBe('stats');
  });

  it('StatsToken_RendersStatStrip', () => {
    render(<PageBody body={`{{stats: ${RAW}}}`} />);
    for (const [value, label] of [['2022', 'Founded'], ['~30', 'Scouts'], ['25', 'Families'], ['10', 'Adult Leaders']]) {
      const v = screen.getByText(value);
      expect(v.nextElementSibling?.textContent).toBe(label);
    }
  });
});

describe('sidebar', () => {
  const SIDEBAR = [
    '## When & Where',
    '',
    '- **Day** Most Sundays',
    '- **Place** Northwoods\\',
    '  [1572 E Capitol Drive](https://example.org/map)\\',
    '  Milwaukee, WI',
    '',
    '## New Here?',
    '',
    'Get to know the troop first. [About the troop](/about)'
  ].join('\n');

  it('Sidebar_SplitsOnH2_IntoModules_AndLabelValueListIntoFactRows', () => {
    expect(splitSidebarModules(SIDEBAR).map((m) => m.title)).toEqual(['When & Where', 'New Here?']);
    // Content before the first `## ` is an untitled module; blank input is no modules at all.
    expect(splitSidebarModules('Just a note.')).toEqual([{ title: null, body: 'Just a note.' }]);
    expect(splitSidebarModules('  \n')).toEqual([]);

    const { container } = render(<PageSidebar markdown={SIDEBAR} />);
    expect(screen.getByRole('heading', { level: 3, name: 'When & Where' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'New Here?' })).toBeTruthy();

    // Fact rows: label then value, the value keeping its link and its line breaks.
    const day = screen.getByText('Day');
    expect(day.nextElementSibling?.textContent).toBe('Most Sundays');
    const place = screen.getByText('Place');
    const placeValue = place.nextElementSibling as HTMLElement;
    expect(placeValue.querySelectorAll('br')).toHaveLength(2);
    expect(within(placeValue).getByRole('link', { name: '1572 E Capitol Drive' }).getAttribute('href')).toBe(
      'https://example.org/map'
    );
    // The label is not duplicated inside the value.
    expect(placeValue.textContent).not.toContain('Place');

    // A plain paragraph is a sidebar note, with its link intact.
    expect(screen.getByText(/Get to know the troop first\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'About the troop' }).getAttribute('href')).toBe('/about');
    expect(container.querySelectorAll('ul')).toHaveLength(0);
  });
});
