// Production-style, real Chromium print smoke test using public DEMO fixtures.
// No credentials, real prices or production database connection required.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const origin = process.env.PTG_TEST_ORIGIN || "http://127.0.0.1:3000/first-megasaver-ptg";
const dir = process.env.PTG_PRINT_ARTIFACTS || "ptg-print-visual-artifacts";
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const formats = [
  ["ONE","1 WHOLE",2],
  ["TWO","1/2",1],
  ["FOUR","2 X 2",1],
  ["SIX","2 X 3",1],
  ["AIRCON","AIRCON",1],
  ["SMALL_APPS","SMALL APPS",1],
  ["CARAVAN","CARAVAN",1],
];
try {
  for (const [format, label, pagesExpected] of formats) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(20000);
    await page.goto(origin + "/demo/", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Print Price Tags" }).waitFor();
    const selections = page.locator(".legacy-results-panel tbody input[type=checkbox]");
    if (await selections.count() < 2) throw new Error(format + ": expected 2 demo aircon products");
    await selections.nth(0).check();
    await selections.nth(1).check();
    await page.locator(".preview-format-controls button").filter({ hasText: label }).click();
    await page.emulateMedia({ media: "print" });
    const sheets = page.locator(".ptg-print-preview .legacy-print-sheet");
    const count = await sheets.count();
    if (count !== pagesExpected) throw new Error(format + ": expected " + pagesExpected + " sheets, got " + count);
    const sizes = await sheets.evaluateAll(list => list.map(sheet => ({
      width: Math.round(sheet.getBoundingClientRect().width),
      height: Math.round(sheet.getBoundingClientRect().height),
      scrollWidth: sheet.scrollWidth,
      clientWidth: sheet.clientWidth,
    })));
    if (sizes.some(size => size.scrollWidth > size.clientWidth + 6)) {
      throw new Error(format + ": preview sheet has horizontal overflow: " + JSON.stringify(sizes));
    }
    // The preview container is intentionally hidden on screen and visible
    // only under @media print. Render the *printed PDF* back to PNG instead.
    const pdfPath = join(dir, format.toLowerCase() + "-print.pdf");
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    writeFileSync(pdfPath, pdf);
    const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
    const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    const dimensions = info.match(/^Page size:\s+([\d.]+) x ([\d.]+)/m);
    if (!dimensions || pages !== pagesExpected) throw new Error(
      format + ": printed " + pages + " page(s), expected " + pagesExpected +
      " on Letter; size " + (dimensions?.slice(1).join("x") || "unknown"));
    const width = Number(dimensions[1]), height = Number(dimensions[2]);
    const landscape = format === "TWO" || format === "AIRCON";
    const expectedWidth = landscape ? 792 : 612, expectedHeight = landscape ? 612 : 792;
    if (Math.abs(width - expectedWidth) > 2 || Math.abs(height - expectedHeight) > 2)
      throw new Error(format + ": expected US Letter " + expectedWidth + "x" + expectedHeight +
        "pt, got " + width + "x" + height);
    execFileSync("pdftoppm", ["-f","1","-l","1","-scale-to","1300","-png","-singlefile",
      pdfPath, join(dir, format.toLowerCase() + "-preview")]);
    console.log("PASS", format, pages, "Letter page(s), first-page PDF preview rendered");
    await page.close();
  }
} finally {
  await browser.close();
}
