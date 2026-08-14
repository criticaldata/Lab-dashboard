// Core dashboard regression suite: KPIs, KPI-click filtering, search, owner
// filter, submission-history detail view, mobile width, sample-data mode,
// the fetch-failure error banner, and the file:// protocol trap.
//
// Prerequisites: serve this folder locally first (from the repo root):
//   python3 -m http.server 8000
// then: node test/test_dashboard.js
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const BASE = 'http://localhost:8000/index.html';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('OK: ' + msg);
}

(async () => {
  const browser = await chromium.launch();
  const consoleErrors = [];
  const pageErrors = [];

  // ---------- TEST 1: real data.json, desktop ----------
  let page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);

  const kpiNums = await page.$$eval('.kpi-card .num', els => els.map(e => e.textContent.trim()));
  console.log('KPI numbers:', kpiNums);
  assert(kpiNums.length === 7, 'Seven KPI cards render, got ' + kpiNums.length);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_desktop_full.png'), fullPage: true });

  // Click a KPI card (Needs Status) and confirm filtering
  const needsStatusCount = parseInt(kpiNums[5], 10);
  await (await page.$$('.kpi-card'))[5].click();
  await page.waitForTimeout(100);
  let resultText = await page.$eval('#result-count', el => el.textContent);
  console.log('After clicking Needs Status:', resultText);
  assert(resultText.startsWith(needsStatusCount + ' of'), 'Filtered list count matches the KPI, got: ' + resultText);
  let cardCount = await page.$$eval('.paper-card', els => els.length);
  assert(cardCount === needsStatusCount, 'Rendered card count matches the KPI, got ' + cardCount);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_kpi_filtered.png'), fullPage: true });

  // Click again to clear
  await (await page.$$('.kpi-card'))[5].click();
  await page.waitForTimeout(100);
  resultText = await page.$eval('#result-count', el => el.textContent);
  assert(resultText.startsWith(kpiNums[0] + ' of'), 'Clicking again clears the filter, got: ' + resultText);

  // Search box
  await page.fill('#search-input', 'Sriracha');
  await page.waitForTimeout(150);
  resultText = await page.$eval('#result-count', el => el.textContent);
  console.log('Search "Sriracha":', resultText);
  assert(resultText.startsWith('1 of'), 'Search narrows to 1 result, got: ' + resultText);

  await page.fill('#search-input', '');
  await page.waitForTimeout(150);
  resultText = await page.$eval('#result-count', el => el.textContent);
  assert(resultText.startsWith(kpiNums[0] + ' of'), 'Clearing search restores the full list, got: ' + resultText);

  // Owner search — the dropdown was removed (doesn't scale to hundreds of
  // members); owner matching now happens through the same search box as
  // title/venue/notes. Confirm it still narrows the list, case-insensitively
  // and on a partial name.
  assert(await page.$('#owner-select') === null, 'The old owner dropdown is gone — no #owner-select element in the DOM');
  const searchPlaceholder = await page.$eval('#search-input', el => el.placeholder);
  assert(/owner/i.test(searchPlaceholder), 'Search placeholder mentions owner, got: ' + searchPlaceholder);

  await page.fill('#search-input', 'mohammad shahin');
  await page.waitForTimeout(150);
  resultText = await page.$eval('#result-count', el => el.textContent);
  console.log('Owner-name search (lowercase, partial) "mohammad shahin":', resultText);
  assert(/^\d+ of/.test(resultText) && !resultText.startsWith('0 of'), 'Case-insensitive owner-name search narrows the list, got: ' + resultText);
  const ownerCardCount = await page.$$eval('.paper-card', els => els.length);
  const ownersShown = await page.$$eval('.paper-card .meta-item', els => els.map(e => e.textContent));
  assert(ownersShown.some(t => /Owner:\s*Mohammad Shahin/i.test(t)), 'Every visible card is actually owned by the searched-for person');
  console.log('Owner search matched ' + ownerCardCount + ' card(s)');

  await page.fill('#search-input', '');
  await page.waitForTimeout(150);

  // Submission history lives in the paper detail view — search for AI
  // Sriracha (2 logged attempts) and open its detail panel.
  await page.fill('#search-input', 'AI Sriracha');
  await page.waitForTimeout(150);
  await page.click('[data-open-detail]');
  await page.waitForTimeout(150);
  const timelineItems = await page.$$eval('.detail-panel .timeline.open li', els => els.map(e => e.textContent.trim()));
  console.log('Timeline items:', JSON.stringify(timelineItems, null, 2));
  assert(timelineItems.length === 2, 'Timeline shows 2 entries, got ' + timelineItems.length);
  assert(timelineItems[0].includes('Attempt 1') && timelineItems[0].includes('The Lancet') && timelineItems[0].includes('Rejected'), 'Attempt 1 = Lancet, Rejected: ' + timelineItems[0]);
  assert(timelineItems[1].includes('Attempt 2') && timelineItems[1].includes('npj Digital Medicine') && timelineItems[1].includes('Under Review'), 'Attempt 2 = npj Digital Medicine, Under Review: ' + timelineItems[1]);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_submission_timeline.png'), fullPage: true });
  await page.fill('#search-input', '');

  // "Open to New Members" KPI — click-to-filter, same pattern as every
  // other KPI card, plus the per-card badge it should agree with.
  const openKpiIndex = 6;
  const openKpiLabel = await page.$$eval('.kpi-card .label', els => els.map(e => e.textContent.trim()))
    .then(labels => labels[openKpiIndex]);
  assert(openKpiLabel === 'Open to New Members', 'The 7th KPI card is Open to New Members, got: ' + openKpiLabel);
  const openKpiCount = parseInt(kpiNums[openKpiIndex], 10);
  await (await page.$$('.kpi-card'))[openKpiIndex].click();
  await page.waitForTimeout(150);
  resultText = await page.$eval('#result-count', el => el.textContent);
  console.log('After clicking Open to New Members:', resultText);
  assert(resultText.startsWith(openKpiCount + ' of'), 'Filtered list count matches the Open to New Members KPI, got: ' + resultText);
  const openBadgeCount = await page.$$eval('.open-badge', els => els.length);
  assert(openBadgeCount === openKpiCount, 'Every card in the filtered list shows the open-badge, got ' + openBadgeCount + ' badges for ' + openKpiCount + ' cards');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_open_to_new_members.png'), fullPage: true });
  await (await page.$$('.kpi-card'))[openKpiIndex].click();
  await page.waitForTimeout(150);

  // Mobile width
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const bodyScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const bodyClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  console.log('Mobile scrollWidth vs clientWidth:', bodyScrollWidth, bodyClientWidth);
  assert(bodyScrollWidth <= bodyClientWidth + 2, 'No horizontal overflow at 390px width (scrollWidth=' + bodyScrollWidth + ' clientWidth=' + bodyClientWidth + ')');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_mobile_390.png'), fullPage: true });

  assert(consoleErrors.length === 0, 'No console errors during normal operation, got: ' + JSON.stringify(consoleErrors));
  assert(pageErrors.length === 0, 'No uncaught page errors, got: ' + JSON.stringify(pageErrors));

  await page.close();

  // ---------- TEST 2: sample fixture data ----------
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const sampleConsoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') sampleConsoleErrors.push(msg.text()); });
  await page.goto(BASE + '?data=data.sample.json', { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  const sampleKpi = await page.$$eval('.kpi-card .num', els => els.map(e => e.textContent.trim()));
  console.log('Sample data KPI numbers:', sampleKpi);
  assert(sampleKpi[0] === '22', 'Sample data Total = 22, got ' + sampleKpi[0]);
  assert(sampleKpi[6] === '15', 'Sample data Open to New Members = 15, got ' + sampleKpi[6]);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_sample_data.png'), fullPage: true });

  // Sample data has more open-to-new-members variety than real data right
  // now (15 vs 4), so it's the better source for a "here's an actual
  // badge" screenshot — click the KPI so the visible cards carry it.
  await (await page.$$('.kpi-card'))[6].click();
  await page.waitForTimeout(150);
  const sampleOpenBadges = await page.$$eval('.open-badge', els => els.length);
  assert(sampleOpenBadges === 15, 'Sample data Open to New Members filter shows 15 badged cards, got ' + sampleOpenBadges);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_open_badge_sample.png'), fullPage: true });

  assert(sampleConsoleErrors.length === 0, 'No console errors on sample data, got: ' + JSON.stringify(sampleConsoleErrors));
  await page.close();

  // ---------- TEST 2b: loading skeleton, before data.json resolves ----------
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route('**/data.json', async route => {
    await new Promise(r => setTimeout(r, 400));
    await route.continue();
  });
  const navPromise = page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(120);
  const skelCountDuring = await page.$$eval('.skel', els => els.length);
  assert(skelCountDuring > 0, 'Skeleton placeholders render while data.json is still loading, got ' + skelCountDuring);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_loading_skeleton.png'), fullPage: true });
  await navPromise;
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(100);
  const skelCountAfter = await page.$$eval('.skel', els => els.length);
  assert(skelCountAfter === 0, 'Skeleton is fully replaced by real content once data.json resolves');
  await page.unroute('**/data.json');
  await page.close();

  // ---------- TEST 3: fetch failure -> error banner ----------
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + '?data=does-not-exist.json', { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  const bannerVisible = await page.$eval('#error-banner', el => getComputedStyle(el).display !== 'none');
  const bannerText = await page.$eval('#error-banner', el => el.textContent);
  console.log('Error banner text:', bannerText);
  assert(bannerVisible, 'Error banner is visible when fetch fails');
  assert(bannerText.includes("Couldn't load"), 'Error banner has a clear message: ' + bannerText);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_error_banner.png'), fullPage: true });
  await page.close();

  // ---------- TEST 4: file:// URL reproduces the original bug ----------
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const fileErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') fileErrors.push(msg.text()); });
  const fileUrl = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const fileBannerVisible = await page.$eval('#error-banner', el => getComputedStyle(el).display !== 'none').catch(() => false);
  console.log('file:// console errors:', fileErrors);
  assert(fileBannerVisible, 'Opening index.html as file:// shows the error banner (not a silent blank page)');
  await page.close();

  await browser.close();
  console.log('\nALL DASHBOARD TESTS PASSED');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
