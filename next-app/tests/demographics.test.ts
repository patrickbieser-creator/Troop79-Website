import { describe, it, expect } from 'vitest';
import { schoolYearEnd, gradeFromGradYear, gradYearFromGrade, gradeLabel } from '../src/lib/demographics';

/**
 * Derived grade (D-014: graduation_year is stored, grade is computed).
 * Rollover moved Aug 1 → JUNE 15 (Patrick, 2026-08-21): the troop talks
 * about scouts by their UPCOMING grade over the summer ("going into 7th"
 * at summer camp), so once school lets out the roster should already say
 * so. Every derived-grade display (roster, profile, advancement report,
 * change-request diffs) reads this one function.
 */
describe('schoolYearEnd — June 15 rollover', () => {
  it('SchoolYearEnd_IsThisYear_ThroughJune14', () => {
    expect(schoolYearEnd('2026-01-10')).toBe(2026);
    expect(schoolYearEnd('2026-06-14')).toBe(2026);
  });

  it('SchoolYearEnd_RollsToNextYear_OnJune15', () => {
    expect(schoolYearEnd('2026-06-15')).toBe(2027);
    expect(schoolYearEnd('2026-07-31')).toBe(2027);
    expect(schoolYearEnd('2026-12-31')).toBe(2027);
  });
});

describe('gradeFromGradYear / gradYearFromGrade (pure)', () => {
  it('GradeFromGradYear_Is12_InTheFinalSchoolYear', () => {
    expect(gradeFromGradYear(2027, '2026-09-01')).toBe(12);
    expect(gradeFromGradYear(2027, '2027-05-01')).toBe(12);
  });

  it('GradeFromGradYear_PromotesOnJune15_NotAug1', () => {
    // Class of 2030: 8th grade in spring 2026, "going into 9th" from June 15.
    expect(gradeFromGradYear(2030, '2026-06-14')).toBe(8);
    expect(gradeFromGradYear(2030, '2026-06-15')).toBe(9);
    expect(gradeFromGradYear(2030, '2026-07-20')).toBe(9);
  });

  it('GradYearFromGrade_InvertsGradeFromGradYear_EitherSideOfTheRollover', () => {
    for (const onDate of ['2026-06-14', '2026-06-15', '2026-10-01']) {
      for (const grade of [5, 8, 12]) {
        expect(gradeFromGradYear(gradYearFromGrade(grade, onDate), onDate)).toBe(grade);
      }
    }
  });

  it('GradeFromGradYear_ReturnsNull_WithoutAGraduationYear', () => {
    expect(gradeFromGradYear(null)).toBeNull();
  });

  it('GradeLabel_HandlesKindergartenAndGraduated', () => {
    expect(gradeLabel(0)).toBe('K');
    expect(gradeLabel(1)).toBe('1st grade');
    expect(gradeLabel(3)).toBe('3rd grade');
    expect(gradeLabel(11)).toBe('11th grade');
    expect(gradeLabel(13)).toBe('Graduated');
    expect(gradeLabel(null)).toBe('—');
  });
});
