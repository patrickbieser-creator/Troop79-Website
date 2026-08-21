'use client';

/**
 * The public (read-only) view of a published Weekly Advancement Report —
 * Category / Scout toggle, same as the admin's, minus editing. Shared by
 * /advancement/report (latest) and /advancement/report/[id] (permalink).
 */
import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import { ScoutAccordion } from '@/app/_components/ScoutAccordion';
import { buildScoutView, toMarkdown } from '@/lib/advancement-report';
import type { PublishedReport } from '@/lib/advancement-report-store';
import { TabStrip } from '@/app/_components/tab-strip';
import styles from '../report.module.css';

export function PublicReportView({ report, basePath }: { report: PublishedReport; basePath: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialView = searchParams.get('view') === 'scout' ? 'scout' : 'category';
  const [view, setView] = useState<'category' | 'scout'>(initialView);
  const expandScout = searchParams.get('scout');

  const scoutView = useMemo(() => buildScoutView(report.contentJson), [report]);
  const range = { startDate: report.startDate, endDate: report.endDate };
  // Body only — the page already renders its own title/dateline/note; see
  // the admin workspace's identical comment for why.
  const bodyMd = useMemo(
    () => toMarkdown(report.contentJson, range, null, { includeHeader: false }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report]
  );

  function switchView(next: 'category' | 'scout') {
    setView(next);
    const qs = new URLSearchParams(searchParams.toString());
    if (next === 'scout') qs.set('view', 'scout');
    else {
      qs.delete('view');
      qs.delete('scout');
    }
    router.replace(qs.toString() ? `${basePath}?${qs}` : basePath, { scroll: false });
  }

  return (
    <>
      <div className={styles.tabsGap}>
        <TabStrip
          ariaLabel="Report view"
          activeKey={view}
          items={[
            { key: 'category', label: 'By Category', onSelect: () => switchView('category') },
            { key: 'scout', label: 'By Scout', onSelect: () => switchView('scout') }
          ]}
        />
      </div>

      {view === 'category' ? (
        <ArticleBody body={bodyMd} />
      ) : (
        <ScoutAccordion scoutView={scoutView} range={range} expandScout={expandScout} />
      )}
    </>
  );
}
