import { describe, it, expect, afterEach } from 'vitest';
import { boardName, setBoardNameBook } from '../src/lib/meeting-board-shared';

/** Board names (Patrick, 2026-10-31): "Mike B", and only when two people would both be "Mike B", more of the last name
 *  ("Mike Ba", "Mike Bl"), a third letter when two still match. */
afterEach(() => setBoardNameBook([]));

describe('boardName with the name book', () => {
  it('Unique_StaysFirstAndInitial', () => {
    setBoardNameBook(['Mike Babby', 'Mike Black', 'Dan Vest']);
    expect(boardName('Dan Vest')).toBe('Dan V');
  });

  it('TwoMikeB_GetASecondLetter', () => {
    setBoardNameBook(['Mike Babby', 'Mike Black', 'Dan Vest']);
    expect([boardName('Mike Babby'), boardName('Mike Black')]).toEqual(['Mike Ba', 'Mike Bl']);
  });

  it('StillMatching_GetsAThirdLetter', () => {
    setBoardNameBook(['Ann Black', 'Ann Blake', 'Ann Brown']);
    expect([boardName('Ann Black'), boardName('Ann Blake'), boardName('Ann Brown')]).toEqual(['Ann Blac', 'Ann Blak', 'Ann Br']);
  });

  it('NoBook_IsFirstAndInitial', () => {
    expect(boardName('Mike Babby')).toBe('Mike B');
  });

  it('SameFullNameTwice_IsLeftAlone', () => {
    setBoardNameBook(['Sam Lee', 'Sam Lee']);
    expect(boardName('Sam Lee')).toBe('Sam L');
  });
});
