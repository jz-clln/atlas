import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_WIDTH = 612; // US Letter, in points
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const TITLE_FONT_SIZE = 18;
const BODY_FONT_SIZE = 11;
const LINE_HEIGHT = 16;

/**
 * Builds a simple single-column PDF from a title and plain-text content.
 * pdf-lib has no built-in word wrapping or pagination, so both are done
 * manually here — measuring text width per word and starting a new page
 * whenever the cursor runs past the bottom margin.
 */
export async function buildPdf(title: string, content: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN;

  page.drawText(title, {
    x: MARGIN,
    y: cursorY,
    size: TITLE_FONT_SIZE,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  cursorY -= TITLE_FONT_SIZE + 14;

  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  const paragraphs = content.split("\n");

  function newPageIfNeeded() {
    if (cursorY < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      cursorY = PAGE_HEIGHT - MARGIN;
    }
  }

  for (const paragraph of paragraphs) {
    const words = paragraph.split(" ");
    let line = "";

    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, BODY_FONT_SIZE);

      if (testWidth > maxWidth && line) {
        newPageIfNeeded();
        page.drawText(line, {
          x: MARGIN,
          y: cursorY,
          size: BODY_FONT_SIZE,
          font,
          color: rgb(0.15, 0.15, 0.15),
        });
        cursorY -= LINE_HEIGHT;
        line = word;
      } else {
        line = testLine;
      }
    }

    if (line) {
      newPageIfNeeded();
      page.drawText(line, {
        x: MARGIN,
        y: cursorY,
        size: BODY_FONT_SIZE,
        font,
        color: rgb(0.15, 0.15, 0.15),
      });
      cursorY -= LINE_HEIGHT;
    }

    cursorY -= 4; // extra breathing room between paragraphs
  }

  return pdfDoc.save();
}