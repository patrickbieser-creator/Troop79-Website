import { PDFDocument, PDFName, StandardFonts, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';

/**
 * The medical binder, one person at a time (Plans/Health-Forms.md, tech-lead: "per person, assembled in the
 * browser"). This builds ONE person's section: a header page (who, standing, what the family told us, who to
 * call, what is on file), then every page of every document. Photos are embedded as they are, never recompressed;
 * a PDF's pages are copied in. A PDF that can't be read (password-protected, damaged) becomes a page that says to
 * print it separately, and is named in `unmerged` so the cover sheet can flag it.
 *
 * Pure: it takes decrypted bytes and returns bytes. The route that calls it does the access check and the log.
 */
export interface BinderPage {
  name: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface BinderDoc {
  label: string;
  /** "On file", "Missing", "Good until Mar 4, 2027"… */
  status: string;
  pages: BinderPage[];
}

export interface BinderPerson {
  name: string;
  /** "Scout" or "Adult". */
  kind: string;
  standing: string;
  eventTitle: string;
  printedOn: string;
  told: string | null;
  contacts: string[];
  docs: BinderDoc[];
}

/** A health form is a handful of pages: a PDF longer than this is printed on its own, not parsed into the binder. */
export const MAX_PDF_PAGES = 30;
/** The family's note on the header page; the rest is on the site. */
const MAX_TOLD = 900;

const LETTER: [number, number] = [612, 792];
const MARGIN = 54;
const INK = rgb(0.13, 0.13, 0.13);
const MUTED = rgb(0.4, 0.4, 0.4);

/** The standard PDF fonts only draw Latin-1: anything else would throw, so it is swapped or dropped. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\s\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of pdfSafe(text).split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Writes wrapped lines down a page and returns the y under them. Stops at the bottom margin. */
function write(page: PDFPage, text: string, font: PDFFont, size: number, y: number, color = INK): number {
  for (const line of wrap(text, font, size, page.getWidth() - MARGIN * 2)) {
    if (y < MARGIN) break;
    page.drawText(line, { x: MARGIN, y, size, font, color });
    y -= size * 1.35;
  }
  return y;
}

export async function buildPersonBinder(person: BinderPerson): Promise<{ pdf: Uint8Array; unmerged: string[] }> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const plain = await doc.embedFont(StandardFonts.Helvetica);
  const unmerged: string[] = [];

  const head = doc.addPage(LETTER);
  let y = LETTER[1] - MARGIN;
  y = write(head, person.name, bold, 24, y);
  y = write(head, `${person.kind} · ${person.standing}`.replace('·', '-'), plain, 12, y - 2, MUTED);
  y = write(head, `${person.eventTitle} - printed ${person.printedOn}`, plain, 10, y, MUTED) - 14;

  y = write(head, 'What the family told us', bold, 13, y) - 2;
  const told = person.told?.trim() || 'Nothing written.';
  // Cut with a marker, so a long note can never push the phone numbers and the document list off the page.
  y = write(head, told.length > MAX_TOLD ? `${told.slice(0, MAX_TOLD)}... (cut short here: read the rest on the site)` : told, plain, 12, y);
  y = write(head, 'Typed by the family, not read from the form. Check the form for allergies and medicines.', plain, 9, y, MUTED) - 14;

  y = write(head, 'Who to call', bold, 13, y) - 2;
  for (const c of person.contacts.length ? person.contacts : ['Nobody on file.']) y = write(head, c, plain, 12, y);
  y -= 14;

  y = write(head, 'Documents', bold, 13, y) - 2;
  for (const d of person.docs) y = write(head, `${d.label}: ${d.status}${d.pages.length ? ` (${d.pages.length} page${d.pages.length === 1 ? '' : 's'})` : ''}`, plain, 12, y);

  const note = (title: string, body: string) => {
    const p = doc.addPage(LETTER);
    const top = write(p, title, bold, 16, LETTER[1] - MARGIN) - 6;
    write(p, body, plain, 12, top);
  };

  for (const d of person.docs) {
    for (const pg of d.pages) {
      const caption = `${person.name} - ${d.label}, ${pg.name.toLowerCase()}`;
      try {
        if (pg.contentType === 'application/pdf') {
          const src = await PDFDocument.load(pg.bytes);
          if (src.getPageCount() > MAX_PDF_PAGES) throw new Error('too many pages');
          for (const copied of await doc.copyPages(src, src.getPageIndices())) {
            // A family's PDF is paper to us: its links, form actions and page-open scripts stay behind.
            copied.node.delete(PDFName.of('Annots'));
            copied.node.delete(PDFName.of('AA'));
            doc.addPage(copied);
          }
        } else {
          const image = pg.contentType === 'image/png' ? await doc.embedPng(pg.bytes) : await doc.embedJpg(pg.bytes);
          // A wide photo gets a landscape sheet; either way it is scaled to fit inside the margins, never cropped.
          const size: [number, number] = image.width > image.height ? [LETTER[1], LETTER[0]] : LETTER;
          const p = doc.addPage(size);
          const room = { w: size[0] - 72, h: size[1] - 72 - 14 };
          const scale = Math.min(room.w / image.width, room.h / image.height, 1.5);
          const w = image.width * scale;
          const h = image.height * scale;
          p.drawImage(image, { x: (size[0] - w) / 2, y: 36 + (room.h - h) / 2, width: w, height: h });
          p.drawText(pdfSafe(caption).slice(0, 110), { x: 36, y: size[1] - 28, size: 9, font: plain, color: MUTED });
        }
      } catch {
        unmerged.push(`${person.name}: ${d.label}, ${pg.name.toLowerCase()}`);
        note('Could not merge - print separately', `${caption}. This file could not be added to the binder (it may be password-protected or damaged). Open it from the site and print it on its own.`);
      }
    }
  }
  return { pdf: await doc.save(), unmerged };
}
