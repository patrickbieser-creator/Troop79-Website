import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';
import { buildPersonBinder, MAX_PDF_PAGES, pdfSafe, type BinderPerson } from '../src/lib/health-binder';

/** One person's section of the medical binder (Plans/Health-Forms.md): real image and PDF bytes, no database. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64'
);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function pdfOf(pages: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) d.addPage([612, 792]);
  return d.save();
}

const person = (docs: BinderPerson['docs'], over: Partial<BinderPerson> = {}): BinderPerson => ({
  name: 'Ben Example',
  kind: 'Scout',
  standing: 'Ready for review',
  eventTitle: 'Fall Camp',
  printedOn: 'Nov 13, 2026',
  told: 'Allergic to bee stings — carries an EpiPen.',
  contacts: ['Dana Example: 414-555-0100'],
  docs,
  ...over
});
const pageCount = async (pdf: Uint8Array) => (await PDFDocument.load(pdf)).getPageCount();

describe('buildPersonBinder', () => {
  it('APersonWithNothingOnFile_StillGetsTheirHeaderPage', async () => {
    const { pdf, unmerged } = await buildPersonBinder(person([{ label: 'BSA health form, Parts A and B', status: 'Missing', pages: [] }]));
    expect([await pageCount(pdf), unmerged]).toEqual([1, []]);
  });

  it('EachPhoto_BecomesOnePage_AfterTheHeader', async () => {
    const { pdf } = await buildPersonBinder(
      person([
        { label: 'Insurance card', status: 'On file', pages: [{ name: 'Front', contentType: 'image/jpeg', bytes: JPEG }, { name: 'Back', contentType: 'image/png', bytes: PNG }] }
      ])
    );
    expect(await pageCount(pdf)).toBe(3);
  });

  it('APdf_ContributesEveryOneOfItsPages', async () => {
    const { pdf } = await buildPersonBinder(person([{ label: 'BSA health form, Parts A and B', status: 'On file', pages: [{ name: 'Page 1', contentType: 'application/pdf', bytes: await pdfOf(3) }] }]));
    expect(await pageCount(pdf)).toBe(4);
  });

  it('AnUnreadablePdf_BecomesAPrintSeparatelyPage_AndIsNamed', async () => {
    const { pdf, unmerged } = await buildPersonBinder(
      person([{ label: 'BSA health form, Part C', status: 'On file', pages: [{ name: 'Page 1', contentType: 'application/pdf', bytes: Buffer.from('%PDF-1.7 not really a pdf') }] }])
    );
    expect([await pageCount(pdf), unmerged]).toEqual([2, ['Ben Example: BSA health form, Part C, page 1']]);
  });

  it('AFamilysPdf_LosesItsLinksAndPageActions', async () => {
    const src = await PDFDocument.create();
    const page = src.addPage([612, 792]);
    const link = src.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 612, 792], A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://evil.example/') } });
    page.node.set(PDFName.of('Annots'), src.context.obj([src.context.register(link)]));
    page.node.set(PDFName.of('AA'), src.context.obj({ O: { Type: 'Action', S: 'JavaScript', JS: PDFString.of('app.alert(1)') } }));
    const { pdf } = await buildPersonBinder(person([{ label: 'BSA health form, Parts A and B', status: 'On file', pages: [{ name: 'Page 1', contentType: 'application/pdf', bytes: await src.save() }] }]));
    const copied = (await PDFDocument.load(pdf)).getPage(1).node;
    expect([copied.get(PDFName.of('Annots')), copied.get(PDFName.of('AA')), Buffer.from(pdf).includes('evil.example')]).toEqual([undefined, undefined, false]);
  });

  it('APdfLongerThanAForm_IsPrintedSeparately_NotParsedIn', async () => {
    const { pdf, unmerged } = await buildPersonBinder(
      person([{ label: 'Immunization record', status: 'On file', pages: [{ name: 'Page 1', contentType: 'application/pdf', bytes: await pdfOf(MAX_PDF_PAGES + 1) }] }])
    );
    expect([await pageCount(pdf), unmerged.length]).toEqual([2, 1]);
  });

  it('ABrokenPhoto_DoesNotStopTheRestOfTheSection', async () => {
    const { pdf, unmerged } = await buildPersonBinder(
      person([
        { label: 'Insurance card', status: 'On file', pages: [{ name: 'Front', contentType: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff, 1, 2]) }, { name: 'Back', contentType: 'image/jpeg', bytes: JPEG }] }
      ])
    );
    expect([await pageCount(pdf), unmerged.length]).toEqual([3, 1]);
  });

  it('ANameOrNoteWithCharactersThePdfFontLacks_StillBuilds', async () => {
    const { pdf } = await buildPersonBinder(person([], { name: 'Zoë Łukasz 🙂', told: 'Peanuts → hives\nSecond line “quoted”' }));
    expect(await pageCount(pdf)).toBe(1);
  });

  it('AVeryLongFamilyNote_StaysOnTheHeaderPage', async () => {
    const { pdf } = await buildPersonBinder(person([], { told: 'word '.repeat(3000) }));
    expect(await pageCount(pdf)).toBe(1);
  });
});

describe('pdfSafe', () => {
  it('SwapsCurlyQuotesAndDashes_AndDropsWhatCannotBeDrawn', () => {
    expect(pdfSafe('Ben’s “form” — page 🙂 Zoë')).toBe('Ben\'s "form" - page Zoë');
  });
});
