import { describe, it, expect } from 'vitest';
import { UNITS, parseAmountWithUnit } from '../src/lib/menu-monster/units';
import type { Ingredient } from '../src/lib/menu-monster/types';

const ing = (id: string, name: string, unit: Ingredient['unit']): Ingredient => ({ id, name, unit, section: 'dry', staple: false, avoid: [], retiredAt: null });
const OIL = ing('oil', 'Cooking oil', UNITS.tbsp);
const EGGS = ing('eggs', 'Eggs', UNITS.egg);

describe('parseAmountWithUnit', () => {
  it('CupsOnATbspIngredient_SetsTheCupUnit', () => {
    expect(parseAmountWithUnit('4 cups', OIL, [])).toEqual({ amount: '4', unitKey: 'cup' });
  });

  it('AFractionWithASingularWord_KeepsTheFraction', () => {
    expect(parseAmountWithUnit('½ cup', OIL, [])).toEqual({ amount: '½', unitKey: 'cup' });
  });

  it('TheIngredientsOwnUnitLabel_MatchesCaseInsensitively', () => {
    expect(parseAmountWithUnit('3 TBSP', OIL, [])).toEqual({ amount: '3', unitKey: 'tbsp' });
  });

  it('CountsOnACountIngredient_NamesTheCountUnit', () => {
    expect(parseAmountWithUnit('2 eggs', EGGS, [])).toEqual({ amount: '2', unitKey: 'egg' });
  });

  it('CupsOnACountIngredient_IsABadUnitWithTheWord', () => {
    expect(parseAmountWithUnit('4 cups', EGGS, [])).toEqual({ bad: 'unit', word: 'cups' });
  });

  it('ANumberAlone_LeavesTheUnitUnchanged', () => {
    expect(parseAmountWithUnit('4', OIL, [])).toEqual({ amount: '4', unitKey: null });
  });

  it('AnUnknownWord_IsLeftAsTyped', () => {
    expect(parseAmountWithUnit('4 cupz', OIL, [])).toBeNull();
  });

  it('AWordWithNoNumber_IsLeftAsTyped', () => {
    expect(parseAmountWithUnit('cups', OIL, [])).toBeNull();
  });

  it('ABridgedUnit_IsAcceptedAcrossFamilies', () => {
    const conv = [{ ingredientId: 'eggs', from: 'egg', to: 'cup', factor: 0.25, label: null }];
    expect(parseAmountWithUnit('1 cup', EGGS, conv)).toEqual({ amount: '1', unitKey: 'cup' });
  });

  it('TypingAQuart_SetsTheUnit', () => {
    expect(parseAmountWithUnit('1 quart', OIL, [])).toEqual({ amount: '1', unitKey: 'quart' });
    expect(parseAmountWithUnit('2 gallons', OIL, [])).toEqual({ amount: '2', unitKey: 'gallon' });
  });
});
