'use client';

import { useState } from 'react';
import { Button } from '@/app/_components/button';
import { HEALTH_STANDING_LABEL, type HealthStanding } from '@/lib/health-records';
import { centralToday } from '@/lib/dates';
import { fmtDate } from '@/lib/format-date';
import styles from './health.module.css';

/**
 * Print binder (Plans/Health-Forms.md): the browser asks the site for each attendee's section in turn, joins
 * them, puts a cover sheet on top and saves one PDF. Scouts A to Z, then adults A to Z. Nothing is kept: the
 * file goes straight to the leader's downloads, and each section is logged as printed.
 */
export interface BinderPersonRow {
  personId: number;
  name: string;
  isScout: boolean;
  standing: HealthStanding;
}

export function PrintBinder({ signupId, title, when, people }: { signupId: number; title: string; when: string; people: BinderPersonRow[] }) {
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const order = [...people].sort((a, b) => Number(b.isScout) - Number(a.isScout) || a.name.localeCompare(b.name));

  async function build() {
    setError(null);
    try {
      setProgress('Getting ready…');
      const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
      const out = await PDFDocument.create();
      const flagged: string[] = [];
      const failed: string[] = [];
      let n = 0;
      for (const p of order) {
        n += 1;
        setProgress(`${n} of ${order.length}: ${p.name}`);
        const res = await fetch(`/api/health-binder/${p.personId}?event=${signupId}`, { cache: 'no-store' });
        if (!res.ok) {
          failed.push(p.name);
          continue;
        }
        try {
          flagged.push(...(JSON.parse(decodeURIComponent(res.headers.get('X-Binder-Flagged') ?? '%5B%5D')) as string[]));
        } catch {
          /* the list was cut short: the section's own pages still say what couldn't be merged */
        }
        const section = await PDFDocument.load(await res.arrayBuffer());
        for (const page of await out.copyPages(section, section.getPageIndices())) out.addPage(page);
      }

      setProgress('Adding the cover sheet…');
      const bold = await out.embedFont(StandardFonts.HelveticaBold);
      const plain = await out.embedFont(StandardFonts.Helvetica);
      const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
      // The cover goes in front; a long list runs on to a second cover page, placed right after the first.
      let covers = 1;
      let cover = out.insertPage(0, [612, 792]);
      let y = 738;
      const line = (text: string, size = 12, font = plain) => {
        if (y < 60) {
          cover = out.insertPage(covers, [612, 792]);
          covers += 1;
          y = 738;
        }
        cover.drawText(safe(text).slice(0, 95), { x: 54, y, size, font });
        y -= size * 1.5;
      };
      line('Medical binder', 26, bold);
      line(`${title} - ${when}`, 14);
      line(`Printed ${fmtDate(centralToday())}. Kept by the health officer.`, 10);
      y -= 10;
      const not = order.filter((p) => p.standing !== 'complete');
      line(`${order.length} people: ${order.length - not.length} complete, ${not.length} need attention`, 13, bold);
      y -= 6;
      if (not.length) {
        line('Needs attention', 13, bold);
        for (const p of not) line(`${p.name} (${p.isScout ? 'scout' : 'adult'}): ${HEALTH_STANDING_LABEL[p.standing]}`);
        y -= 6;
      }
      if (flagged.length || failed.length) {
        line('Print these separately', 13, bold);
        for (const f of flagged) line(f);
        for (const f of failed) line(`${f}: the whole section could not be built`);
        y -= 6;
      }
      line('In this binder', 13, bold);
      for (const p of order) line(`${p.name}${p.isScout ? '' : ' (adult)'}`);

      const bytes = await out.save();
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `medical-binder-${title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'trip'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setProgress(failed.length ? `Saved, but ${failed.length} section${failed.length === 1 ? '' : 's'} could not be built. See the cover sheet.` : 'Saved to your downloads.');
    } catch {
      setProgress(null);
      setError('The binder couldn’t be built. Try again; if it keeps failing, open each person and print their pages.');
    }
  }

  const working = progress != null && !progress.startsWith('Saved');
  return (
    <div className={styles.binder}>
      <Button variant="primary" disabled={working || order.length === 0} onClick={build}>
        Print binder ({order.length})
      </Button>
      {progress && (
        <span role="status" className={styles.binderStatus}>
          {progress}
        </span>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
