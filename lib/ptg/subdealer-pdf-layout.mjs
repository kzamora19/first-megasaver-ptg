import { positionedPromotionRows } from "./promotion-pdf-layout.mjs";

// Subdealer PDFs use multiline and irregularly spaced headings. Normalize
// text per PDF item without changing the existing promotion PDF importer.
export function positionedSubdealerRows(document) {
  return positionedPromotionRows({
    ...document,
    pages: document.pages.map(page => ({
      ...page,
      items: page.items.map(item => ({
        ...item,
        text: String(item.text ?? "").replace(/\s+/g, " ").trim(),
      })),
    })),
  });
}
