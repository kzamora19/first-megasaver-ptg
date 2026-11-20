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
    // SAVE must generate a browser download without invoking the print dialog.
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => { window.print = () => { throw new Error("SAVE must not call window.print"); }; });
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 90000 }),
      page.locator("#print-price-tags .save-pdf").click(),
    ]);
    if (!download.suggestedFilename().endsWith(".pdf")) {
      throw new Error(format + ": SAVE did not download a PDF file");
    }
    const savedPath = await download.path();
    if (!savedPath) throw new Error(format + ": browser did not expose downloaded PDF");
    const savedInfo = execFileSync("pdfinfo", [savedPath], { encoding: "utf8" });
    const savedPages = Number(savedInfo.match(/^Pages:\s+(\d+)/m)?.[1]);
    const savedDimensions = savedInfo.match(/^Page size:\s+([\d.]+) x ([\d.]+)/m);
    const savedWidth = Number(savedDimensions?.[1]), savedHeight = Number(savedDimensions?.[2]);
    if (savedPages !== pagesExpected || Math.abs(savedWidth - expectedWidth) > 2 ||
        Math.abs(savedHeight - expectedHeight) > 2) {
      throw new Error(format + ": SAVE PDF pages/dimensions wrong: " +
        savedPages + " page(s), " + savedWidth + "x" + savedHeight + " pt");
    }
    console.log("PASS SAVE", format, savedPages, "downloaded Letter PDF page(s), no printer dialog");
    await page.close();
  }
  // The real batch planner must be reachable from the UI, with each copy
  // represented in the print output and no duplicate-key React warnings.
  const batchPage = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const browserErrors = [];
  batchPage.on("pageerror", error => browserErrors.push(error.message));
  batchPage.on("console", message => {
    if (message.type() === "error" && /same key|duplicate key|unique "key"/i.test(message.text()))
      browserErrors.push(message.text());
  });
  await batchPage.goto(origin + "/demo/", { waitUntil: "networkidle" });
  await batchPage.locator(".legacy-results-panel tbody input[type=checkbox]").nth(0).check();
  await batchPage.locator(".legacy-results-panel tbody input[type=checkbox]").nth(1).check();
  await batchPage.getByLabel("Plan print formats and copies per product").check();
  const printPanel = batchPage.locator("#print-price-tags");
  if (await printPanel.count() !== 1)
    throw new Error("Print Price Tags panel must remain visible in batch mode.");
  if (await printPanel.locator(".preview-format-controls button:not(:disabled)").count() !== 0)
    throw new Error("Global format buttons must be disabled in batch mode.");
  if (!await printPanel.getByRole("button", { name: /Print/ }).isEnabled())
    throw new Error("Original Print button must remain available.");
  const formatSelectors = batchPage.locator(".legacy-queue-panel .ptg-queue-print-settings select");
  const counts = batchPage.locator(".legacy-queue-panel .ptg-queue-print-settings input[type=number]");
  if (await formatSelectors.count() !== 2 || await counts.count() !== 2)
    throw new Error("Batch planner must expose a format and copies field for each queued product.");
  await formatSelectors.nth(0).selectOption("ONE");
  await counts.nth(0).fill("3");
  await formatSelectors.nth(1).selectOption("TWO");
  await counts.nth(1).fill("2");
  const planned = batchPage.locator(".ptg-batch-groups");
  if (!await planned.getByRole("button", { name: /1 WHOLE: 1 product\(s\) \/ 3 tag\(s\)/ }).count())
    throw new Error("Batch planner did not display three ONE tags.");
  for (const [code, label, pagesExpected] of [["ONE","1 WHOLE",3],["TWO","1/2",1]]) {
    await batchPage.emulateMedia({ media: "screen" });
    await batchPage.locator(".ptg-batch-groups button").filter({hasText:label}).click();
    await batchPage.emulateMedia({ media: "print" });
    const sheets = await batchPage.locator(".ptg-print-preview .legacy-print-sheet").count();
    if (sheets !== pagesExpected) throw new Error(code + " batch should have " + pagesExpected + " sheets; got " + sheets);
    const pdf = await batchPage.pdf({ preferCSSPageSize: true, printBackground: true });
    const path = join(dir, "batch-" + code.toLowerCase() + ".pdf");
    writeFileSync(path, pdf);
    const info = execFileSync("pdfinfo", [path], { encoding: "utf8" });
    if (Number(info.match(/^Pages:\s+(\d+)/m)?.[1]) !== pagesExpected)
      throw new Error(code + " batch PDF page count mismatch.");
  }
  if (browserErrors.length) throw new Error("Batch planner browser error: " + browserErrors.join("; "));
  await batchPage.close();
  console.log("PASS batch planner: per-product format selection, repeated copies, and PDF page counts.");
} finally {
  await browser.close();
}
