// F28: thin adapter around unpdf/pdf.js - extracts positioned text items per page so
// the actual parsing stays in the pure, offline-testable knvb-kalender module.
import { getDocumentProxy } from 'unpdf'
import type { PdfTextItem } from './knvb-kalender'

export async function extractPdfTextItems(data: Uint8Array): Promise<PdfTextItem[][]> {
  const doc = await getDocumentProxy(data)
  const pages: PdfTextItem[][] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    pages.push(
      (content.items as { str?: string, width?: number, transform?: number[] }[])
        .filter(i => typeof i.str === 'string' && i.str.trim() && Array.isArray(i.transform))
        .map(i => ({
          str: i.str!.trim(),
          x: i.transform![4]!,
          y: i.transform![5]!,
          w: i.width ?? 0
        }))
    )
  }
  return pages
}
