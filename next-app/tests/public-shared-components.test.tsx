import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageHeader } from '../src/app/_components/page-header';
import { PageShell } from '../src/app/_components/page-shell';
import { Button } from '../src/app/_components/button';
import { Badge } from '../src/app/_components/badge';
import { TabStrip } from '../src/app/_components/tab-strip';
import { Notice } from '../src/app/_components/notice';
import { EmptyState } from '../src/app/_components/empty-state';
import { SectionDivider } from '../src/app/_components/section-divider';
import { Field, TextInput, FieldError } from '../src/app/_components/form';
import { DateField } from '../src/app/_components/date-field';

/**
 * Phase A of Plans/Public-Design-System.md — the public shared components,
 * promoted from the de-facto canon the 2026-08-21 audit identified
 * (library.module.css's shell + form kit; advancement/report's tabs). API
 * shapes mirror the admin _components twins where one exists, implemented
 * against the PUBLIC tokens — admin components are never imported here.
 */

describe('PageHeader', () => {
  it('PageHeader_RendersKickerTitleLede_WhenAllProvided', () => {
    render(<PageHeader kicker="Troop 79 · Library" title="Resources" lede="Everything in one place." />);
    expect(screen.getByRole('heading', { level: 1, name: 'Resources' })).toBeTruthy();
    expect(screen.getByText('Troop 79 · Library')).toBeTruthy();
    expect(screen.getByText('Everything in one place.')).toBeTruthy();
  });

  it('PageHeader_OmitsLede_WhenAbsent', () => {
    const { container } = render(<PageHeader title="Bare" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Bare' })).toBeTruthy();
    expect(container.querySelectorAll('p').length).toBe(0);
  });
});

describe('PageShell', () => {
  it('PageShell_AppliesNarrowClass_WhenWidthNarrow', () => {
    const { container } = render(
      <PageShell width="narrow">
        <p>content</p>
      </PageShell>
    );
    const main = container.firstElementChild as HTMLElement;
    expect(main.className).toMatch(/narrow/i);
  });
});

describe('Button', () => {
  it('PublicButton_MapsVariant_ToSemanticClass', () => {
    render(<Button variant="danger">Withdraw</Button>);
    expect(screen.getByRole('button', { name: 'Withdraw' }).className).toMatch(/danger/i);
  });

  it('PublicButton_AppliesCompactSize_WhenSizeSm', () => {
    render(
      <Button variant="secondary" size="sm">
        Submit news
      </Button>
    );
    expect(screen.getByRole('button', { name: 'Submit news' }).className).toMatch(/sm/);
  });

  it('PublicButton_MapsDangerGhost_ToQuietDangerClass', () => {
    render(<Button variant="dangerGhost">Remove</Button>);
    expect(screen.getByRole('button', { name: 'Remove' }).className).toMatch(/dangerGhost/i);
  });

  it('PublicButton_RendersLink_WhenHrefProvided', () => {
    render(
      <Button variant="primary" href="/join">
        Join
      </Button>
    );
    expect(screen.getByRole('link', { name: 'Join' }).getAttribute('href')).toBe('/join');
  });
});

describe('Badge', () => {
  it('PublicBadge_MapsTone_ToSemanticClass', () => {
    render(<Badge tone="success">Paid</Badge>);
    expect(screen.getByText('Paid').className).toMatch(/success/i);
  });

  it('PublicBadge_SkipsUppercase_WhenCapsFalse', () => {
    render(
      <Badge tone="accent" caps={false}>
        ✓ Completed Mar 2026
      </Badge>
    );
    expect(screen.getByText('✓ Completed Mar 2026').className).toMatch(/noCaps/i);
  });
});

describe('TabStrip', () => {
  it('PublicTabStrip_RendersCount_WhenCountProvided', () => {
    render(
      <TabStrip
        items={[
          { key: 'week', label: 'This Week', count: 4 },
          { key: 'all', label: 'All' }
        ]}
        activeKey="week"
        ariaLabel="Report range"
      />
    );
    expect(screen.getByRole('tab', { name: /This Week/ }).textContent).toContain('4');
  });

  it('PublicTabStrip_MarksOnlyActiveTab_AsSelected', () => {
    render(
      <TabStrip
        items={[
          { key: 'a', label: 'Alpha' },
          { key: 'b', label: 'Beta' }
        ]}
        activeKey="b"
        ariaLabel="Views"
      />
    );
    expect(screen.getAllByRole('tab', { selected: true }).map((el) => el.textContent)).toEqual(['Beta']);
  });

  it('PublicTabStrip_FiresOnSelect_WhenTabClicked', async () => {
    const onSelect = vi.fn();
    render(
      <TabStrip
        items={[
          { key: 'a', label: 'Alpha', onSelect },
          { key: 'b', label: 'Beta' }
        ]}
        activeKey="b"
        ariaLabel="Views"
      />
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Alpha' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('Notice', () => {
  it('PublicNotice_SetsAlertRole_WhenToneError', () => {
    render(<Notice tone="error">Name is required.</Notice>);
    expect(screen.getByRole('alert').textContent).toBe('Name is required.');
  });

  it('PublicNotice_SetsStatusRole_WhenToneSuccess', () => {
    render(<Notice tone="success">Saved.</Notice>);
    expect(screen.getByRole('status').textContent).toBe('Saved.');
  });
});

describe('EmptyState', () => {
  it('EmptyState_RendersAction_WhenActionProvided', () => {
    render(<EmptyState action={<a href="/library/submit">Suggest one</a>}>No resources yet.</EmptyState>);
    expect(screen.getByText('No resources yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Suggest one' }).getAttribute('href')).toBe('/library/submit');
  });
});

describe('SectionDivider', () => {
  it('SectionDivider_RendersLabelAndLink_WhenBothProvided', () => {
    render(<SectionDivider label="This Week" link={<a href="#news">All news</a>} />);
    expect(screen.getByText('This Week')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All news' })).toBeTruthy();
  });
});

describe('Form kit', () => {
  it('FormField_AssociatesLabelAndError_WithInput', () => {
    render(
      <Field label="Your Name" error="Required.">
        <TextInput name="name" />
      </Field>
    );
    const input = screen.getByLabelText('Your Name');
    expect(input.tagName).toBe('INPUT');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('Required.');
    expect(describedBy.split(' ')).toContain(error.id);
  });

  it('FieldError_RendersNothing_WhenChildrenEmpty', () => {
    const { container } = render(<FieldError>{null}</FieldError>);
    expect(container.innerHTML).toBe('');
  });

});

/**
 * Public DateField v2 (Patrick, 2026-08-21): the native <input type="date">
 * of Phase C (D-174 option b) reverted to a rich control — free typing with
 * tolerant parsing (lib/date-entry) plus a calendar popover — built ONLY on
 * public tokens and lib/, never the admin picker (firewall). Same <Field>
 * wiring as TextInput; the ISO value travels in a hidden input under `name`
 * so plain form posts keep working.
 */
describe('Public DateField (rich)', () => {
  it('PublicDateField_ShowsAFormattedTextInput_AndPostsIsoUnderName', () => {
    const { container } = render(
      <Field label="Date of birth">
        <DateField name="dob" defaultValue="2012-04-01" />
      </Field>
    );
    const input = screen.getByLabelText('Date of birth') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('text');
    expect(input.value).toBe('Apr 1, 2012');
    const hidden = container.querySelector('input[type="hidden"][name="dob"]') as HTMLInputElement;
    expect(hidden.value).toBe('2012-04-01');
  });

  it('PublicDateField_CommitsTolerantlyTypedText_AsIso_OnBlur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Date of birth">
        <DateField value="" onChange={onChange} />
      </Field>
    );
    const input = screen.getByLabelText('Date of birth');
    await user.type(input, '7/4/12');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith('2012-07-04');
  });

  it('PublicDateField_CommitsOnEnter_AndFlagsUnrecognizedText_WithoutCommitting', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Date of birth">
        <DateField value="" onChange={onChange} />
      </Field>
    );
    const input = screen.getByLabelText('Date of birth');
    await user.type(input, 'next tuesday{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/unrecognized date/i)).toBeTruthy();
    await user.clear(input);
    await user.type(input, 'Jul 25, 2026{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('2026-07-25');
  });

  it('PublicDateField_ClearingTheText_CommitsEmpty', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Date of birth">
        <DateField value="2012-04-01" onChange={onChange} />
      </Field>
    );
    const input = screen.getByLabelText('Date of birth');
    await user.clear(input);
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('PublicDateField_OpensACalendarDialog_FromTheIconButton_AndPicksToday', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Date of birth">
        <DateField value="" onChange={onChange} />
      </Field>
    );
    await user.click(screen.getByRole('button', { name: /open calendar/i }));
    const dialog = screen.getByRole('dialog', { name: /choose date/i });
    expect(dialog).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Today' }));
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(onChange).toHaveBeenLastCalledWith(iso);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('PublicDateField_ReadOnlyOrDisabled_NeverOpensTheCalendar', async () => {
    const user = userEvent.setup();
    render(
      <Field label="Date of birth">
        <DateField defaultValue="2012-04-01" readOnly />
      </Field>
    );
    await user.click(screen.getByLabelText('Date of birth'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /open calendar/i })).toBeNull();
  });

  it('PublicDateField_HonorsAnExplicitIdAndDescribedBy_OverFieldContext', () => {
    render(<DateField id="pf-birthdate" aria-describedby="pf-birthdate-note" value="" onChange={() => {}} />);
    const input = screen.getByRole('combobox');
    expect(input.id).toBe('pf-birthdate');
    expect(input.getAttribute('aria-describedby')).toBe('pf-birthdate-note');
  });
});
