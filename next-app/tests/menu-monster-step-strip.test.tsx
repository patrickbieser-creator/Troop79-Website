import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StepStrip, type StepStripConfig } from '../src/app/(public)/library/menu-monster/menus/_components/step-strip';

const CONFIG: StepStripConfig = { people: '/m/1/people', plan: '/m/1', gear: '/m/1/gear', shopping: '/m/1/shopping' };
const links = () => within(screen.getByRole('navigation', { name: 'Menu steps' })).getAllByRole('link');

describe('StepStrip', () => {
  it('Steps_ReadWhosEatingMealsGearShopping_InThatOrder', () => {
    render(<StepStrip config={CONFIG} current="eating" />);
    expect(links().map((a) => a.textContent)).toEqual(['Who’s eating', 'Meals', 'Gear', 'Shopping']);
  });

  it('Steps_AreEachALinkToTheirRoute_WhosEatingAndMealsAreTwoRoutes', () => {
    render(<StepStrip config={CONFIG} current="eating" />);
    expect(links().map((a) => a.getAttribute('href'))).toEqual(['/m/1/people', '/m/1', '/m/1/gear', '/m/1/shopping']);
  });

  it('StepStrip_ShowsDoneTicks_NeverLocks', () => {
    render(<StepStrip config={CONFIG} done={{ eating: true, meals: false, gear: true, shopping: false }} current="meals" />);
    const done = links().filter((a) => a.textContent?.includes('✓'));
    expect(done.map((a) => a.textContent)).toEqual(['✓Who’s eating (done)', '✓Gear (done)']);
    // Every step is a live link: nothing is disabled or aria-disabled, even the ones not done yet.
    for (const a of links()) {
      expect(a.getAttribute('href')).toBeTruthy();
      expect(a.getAttribute('aria-disabled')).toBeNull();
    }
  });

  it('Current_IsMarked_WithAriaCurrentStep', () => {
    render(<StepStrip config={CONFIG} current="gear" />);
    expect(links().filter((a) => a.getAttribute('aria-current') === 'step').map((a) => a.textContent)).toEqual(['Gear']);
  });

  it('Current_IsOneStep_WhosEatingAndMealsAreNoLongerOnePage', () => {
    render(<StepStrip config={CONFIG} current="eating" />);
    expect(links().filter((a) => a.getAttribute('aria-current') === 'step').map((a) => a.textContent)).toEqual(['Who’s eating']);
  });

  it('NoStepRoute_UsesAHashAnchor', () => {
    render(<StepStrip config={CONFIG} current="meals" />);
    expect(links().some((a) => (a.getAttribute('href') ?? '').includes('#'))).toBe(false);
  });

  it('WhatWeBought_AppearsAsAFifthStep_OnlyWhenGivenARoute', () => {
    const { unmount } = render(<StepStrip config={CONFIG} current="shopping" />);
    expect(screen.queryByRole('link', { name: 'What we bought' })).toBeNull();
    unmount();
    render(<StepStrip config={{ ...CONFIG, bought: '/m/1/bought' }} current="shopping" />);
    expect(links().map((a) => a.textContent)).toEqual(['Who’s eating', 'Meals', 'Gear', 'Shopping', 'What we bought']);
  });

  it('Share_IsAQuietActionAtTheEnd_NotAStep', () => {
    render(<StepStrip config={{ ...CONFIG, share: { label: 'Share', href: '/m/1/share' } }} current="shopping" />);
    const all = links();
    expect(all[all.length - 1].textContent).toBe('Share');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('Share_IsMarkedCurrent_OnItsOwnPage', () => {
    render(<StepStrip config={{ ...CONFIG, share: { label: 'Share', href: '/m/1/share' } }} current="share" />);
    expect(screen.getByRole('link', { name: 'Share' }).getAttribute('aria-current')).toBe('page');
  });

  it('NoShare_NoAction', () => {
    render(<StepStrip config={CONFIG} current="eating" />);
    expect(screen.queryByRole('link', { name: 'Share' })).toBeNull();
  });
});
