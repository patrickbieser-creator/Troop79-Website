'use client';

/**
 * Test record section: one checkbox for people.is_test, scouts and adults alike. A test record is left out of the
 * EmailOctopus sync and the BSA roster check (lib/newsletter-sync-db, lib/bsa-roster-db). Same per-section Edit →
 * dirty-gated Save/Cancel as the other sections; Save → setPersonIsTest (roster.manage, like every section here).
 */
import { useRouter } from 'next/navigation';
import { setPersonIsTest } from '../person-actions';
import { ReadRow, ReadRows, SectionCard, SectionFormActions, useSectionForm } from './section-card';
import styles from './person-record.module.css';

export interface TestRecordDraft extends Record<string, string> {
  /** 'yes' when ticked, '' when not (section drafts are strings). */
  is_test: string;
}

export function TestRecordSection({ personId, isTest }: { personId: number; isTest: boolean }) {
  const router = useRouter();
  const form = useSectionForm<TestRecordDraft>({
    key: 'test-record',
    title: 'Test record',
    saved: { is_test: isTest ? 'yes' : '' },
    save: (draft) => setPersonIsTest(personId, draft.is_test === 'yes'),
    onSaved: () => router.refresh()
  });

  return (
    <SectionCard title="Test record" form={form}>
      {!form.editing ? (
        <ReadRows>
          <ReadRow label="Test record">{form.saved.is_test === 'yes' ? 'Yes' : 'No'}</ReadRow>
        </ReadRows>
      ) : (
        <>
          <label className={styles.inlineLabel}>
            <input
              type="checkbox"
              checked={form.draft.is_test === 'yes'}
              disabled={form.busy}
              onChange={(e) => form.setField('is_test', e.target.checked ? 'yes' : '')}
            />
            Test record
          </label>
          <p className={styles.hint}>Left out of the EmailOctopus sync and the BSA roster check.</p>
          <SectionFormActions form={form} doneLabel="Test record saved." />
        </>
      )}
    </SectionCard>
  );
}
