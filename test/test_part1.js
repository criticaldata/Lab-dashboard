// Regression suite for: the "Needs Status" collapsible section, the
// per-card "Last updated" field, and the print stylesheet.
//
// Needs Status counts are read from the page's own KPI cards rather than
// hardcoded, so this stays valid as real papers are added/updated over
// time — only the *mechanism* (collapsed by default, count in the summary,
// flat when filtered) is asserted, not today's specific numbers.
//
// Prerequisites: serve this folder locally first (from the repo root):
//   python3 -m http.server 8000
// then: node test/test_part1.js
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:8000/index.html';
const DIR = path.join(__dirname, 'screenshots');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('OK: ' + msg);
}

(async () => {
  const browser = await chromium.launch();

  // ---- Needs Status collapse, default state ----
  let page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);

  const kpiNums = await page.$$eval('.kpi-card .num', els => els.map(e => parseInt(e.textContent, 10)));
  const totalCount = kpiNums[0];
  const needsStatusCount = kpiNums[5];
  console.log('Total:', totalCount, 'Needs Status:', needsStatusCount);

  const activeCards = await page.$$eval('#paper-list > .paper-card', els => els.length);
  console.log('Active (ungrouped) cards shown by default:', activeCards);
  assert(activeCards === totalCount - needsStatusCount, 'Active list shows total-minus-needs-status cards by default, got ' + activeCards);

  if (needsStatusCount > 0) {
    const detailsOpen = await page.$eval('details.needs-status-block', el => el.open);
    assert(detailsOpen === false, 'Needs Status <details> is collapsed by default');

    const summaryText = await page.$eval('details.needs-status-block summary', el => el.textContent);
    console.log('Summary text:', summaryText);
    assert(summaryText.includes(String(needsStatusCount)), 'Summary shows the correct count: ' + summaryText);

    const hiddenCardsCount = await page.$$eval('.needs-status-list .paper-card', els => els.length);
    assert(hiddenCardsCount === needsStatusCount, 'Needs Status section contains the right number of cards, got ' + hiddenCardsCount);

    await page.screenshot({ path: path.join(DIR, 'part1_needs_status_collapsed.png'), fullPage: true });

    await page.click('details.needs-status-block summary');
    await page.waitForTimeout(150);
    const detailsOpenAfterClick = await page.$eval('details.needs-status-block', el => el.open);
    assert(detailsOpenAfterClick === true, 'Clicking summary expands the section');
    await page.screenshot({ path: path.join(DIR, 'part1_needs_status_expanded.png'), fullPage: true });

    // Click the Needs Status KPI while section is manually expanded -> flat, ungrouped
    await (await page.$$('.kpi-card'))[5].click();
    await page.waitForTimeout(150);
    const detailsExistsWhenFiltered = await page.$('details.needs-status-block');
    assert(detailsExistsWhenFiltered === null, 'When a KPI filter is active, the list is flat (no collapsible wrapper)');
    const flatCount = await page.$$eval('#paper-list > .paper-card', els => els.length);
    assert(flatCount === needsStatusCount, 'Flat filtered view still shows every Needs Status paper, got ' + flatCount);
    await (await page.$$('.kpi-card'))[5].click();
    await page.waitForTimeout(150);
  } else {
    console.log('(No Needs Status papers right now — collapsible-mechanism assertions skipped, nothing to collapse.)');
  }

  assert(errors.length === 0, 'No console errors, got: ' + JSON.stringify(errors));
  await page.close();

  // ---- Last-updated field using sample data (which has lastUpdated set) ----
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + '?data=data.sample.json', { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  const listText = await page.evaluate(() => document.getElementById('paper-list').textContent);
  assert(listText.includes('Last updated'), 'Sample data (which has lastUpdated set) shows "Last updated" on at least one card');
  const lastUpdatedCount = await page.$$eval('.meta-item', els => els.filter(e => e.textContent.includes('Last updated')).length);
  console.log('Cards showing Last updated:', lastUpdatedCount);
  assert(lastUpdatedCount === 8, 'All 8 sample papers have lastUpdated and show it, got ' + lastUpdatedCount);
  await page.close();

  // ---- Print stylesheet ----
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);

  await page.emulateMedia({ media: 'print' });
  // emulateMedia() only changes CSS media-query matching — it does not fire
  // the beforeprint/afterprint JS events the way a real print or page.pdf()
  // does, so dispatch it directly to test our listener's own logic.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.waitForTimeout(200);

  const controlsDisplay = await page.$eval('.controls', el => getComputedStyle(el).display);
  assert(controlsDisplay === 'none', 'Search/owner controls are hidden when printing, got display=' + controlsDisplay);

  if (needsStatusCount > 0) {
    const detailsOpenInPrint = await page.$eval('details.needs-status-block', el => el.open);
    assert(detailsOpenInPrint === true, 'Needs Status section force-opens for print even though it was collapsed on screen');
  }

  const demoBannerDisplay = await page.$eval('#demo-banner', el => getComputedStyle(el).display);
  assert(demoBannerDisplay === 'none', 'Demo-mode banner is hidden when printing, got display=' + demoBannerDisplay);

  const printColorAdjust = await page.$eval('.badge', el => getComputedStyle(el).getPropertyValue('print-color-adjust') || getComputedStyle(el).getPropertyValue('-webkit-print-color-adjust'));
  console.log('print-color-adjust on badge:', printColorAdjust);
  assert(printColorAdjust.trim() === 'exact', 'Badge backgrounds are forced to print via print-color-adjust:exact, got: ' + printColorAdjust);

  await page.screenshot({ path: path.join(DIR, 'part1_print_emulated.png'), fullPage: true });

  await page.close();
  await browser.close();
  console.log('\nALL PART 1 TESTS PASSED');
})().catch(err => { console.error(err); process.exit(1); });
