// Regression suite for demo-mode inline editing: opening the paper detail
// view, editing every field type, logging a new submission attempt,
// refresh-persistence, the one-time name prompt, Reset demo data, Copy my
// changes as JSON, and the demo banner's visibility/non-blocking behavior
// — desktop and mobile.
//
// Prerequisites: serve this folder locally first (from the repo root):
//   python3 -m http.server 8000
// then: node test/test_demo_mode.js
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:8000/index.html';
const DIR = path.join(__dirname, 'screenshots');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('OK: ' + msg);
}

async function clearStorage(page) {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
}

(async () => {
  const browser = await chromium.launch();

  // ================= DESKTOP: full flow =================
  let page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await clearStorage(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(200);

  await page.screenshot({ path: path.join(DIR, 'demo_closed_desktop.png'), fullPage: true });

  // ---- Open detail view via title click ----
  await page.fill('#search-input', 'AI Sriracha');
  await page.waitForTimeout(150);
  const titleBtn = await page.$('[data-open-detail]');
  assert(titleBtn !== null, 'Paper title button exists');
  await titleBtn.click();
  await page.waitForTimeout(150);

  const panelOpen = await page.$eval('.detail-panel', el => el.classList.contains('open'));
  assert(panelOpen, 'Detail panel opens on title click');
  const hasSubmissionHistory = await page.$eval('.detail-panel', el => el.textContent.includes('Submission history'));
  assert(hasSubmissionHistory, 'Detail view shows submission history section');
  const timelineEntries = await page.$$eval('.detail-panel .timeline li', els => els.length);
  assert(timelineEntries === 2, 'AI Sriracha detail view shows both submission attempts, got ' + timelineEntries);

  await page.screenshot({ path: path.join(DIR, 'demo_detail_view_desktop.png'), fullPage: true });

  // ---- Open edit form ----
  await page.click('.detail-panel [data-open-edit]');
  await page.waitForTimeout(150);
  const editFormVisible = await page.$eval('.detail-panel', el => el.textContent.includes('Your name'));
  assert(editFormVisible, 'Edit form renders with the name field');

  // Fill name (first time in session)
  await page.fill('.detail-panel input[id$="-name"]', 'Jane Demo');

  // Edit every field type
  await page.selectOption('.detail-panel select[id$="-stage"]', 'Drafting');
  await page.selectOption('.detail-panel select[id$="-priority"]', 'Low');
  await page.fill('.detail-panel input[id$="-deadline"]', '2026-12-01');
  await page.fill('.detail-panel input[id$="-meetdate"]', '2026-09-01T10:00');
  await page.fill('.detail-panel input[id$="-meetlink"]', 'https://zoom.us/j/demo-test');
  await page.fill('.detail-panel input[id$="-draft"]', 'https://docs.google.com/demo-edited-draft');

  await page.click('.detail-panel [data-add-resource]');
  await page.waitForTimeout(100);
  const resRows = await page.$$('.detail-panel .resource-edit-row');
  await resRows[resRows.length - 1].$eval('.res-label', el => el.value = 'Test resource');
  await resRows[resRows.length - 1].$eval('.res-url', el => el.value = 'https://example.org/test-resource');

  await page.screenshot({ path: path.join(DIR, 'demo_edit_form_mid_edit_desktop.png'), fullPage: true });

  // Log a new submission attempt
  await page.fill('.detail-panel input[id$="-venue"]', 'Demo Test Journal');
  await page.fill('.detail-panel input[id$="-submitted"]', '2026-08-10');
  await page.selectOption('.detail-panel select[id$="-decision"]', 'Under Review');

  await page.click('.detail-panel [data-save-edit]');
  await page.waitForTimeout(1200);

  // ---- Confirm it landed back on read view with new values ----
  const readViewText = await page.$eval('.detail-panel', el => el.textContent);
  assert(readViewText.includes('Drafting'), 'Read view shows updated Stage=Drafting');
  assert(readViewText.includes('Low'), 'Read view shows updated Priority=Low');
  assert(readViewText.includes('Demo Test Journal'), 'Read view shows the newly logged submission venue');
  assert(readViewText.includes('Test resource') || readViewText.includes('example.org/test-resource'), 'Read view shows the newly added resource');
  const draftLinkHref = await page.evaluate(() => {
    var links = Array.from(document.querySelectorAll('.detail-panel a'));
    var l = links.find(function(a){ return a.href.includes('demo-edited-draft'); });
    return l ? l.href : null;
  });
  assert(draftLinkHref && draftLinkHref.includes('demo-edited-draft'), 'Read view shows the updated draft link as an href, got: ' + draftLinkHref);
  assert(readViewText.includes('Edited in this demo session'), 'Read view flags the paper as demo-edited');
  assert(readViewText.includes('Jane Demo'), 'Read view attributes the edit to the entered name');

  const editedFlagOnCard = await page.$eval('.paper-card .edited-flag', el => el.textContent);
  assert(editedFlagOnCard.includes('Edited'), 'Compact card shows the Edited (demo) flag');

  assert(consoleErrors.length === 0, 'No console errors during the full edit flow, got: ' + JSON.stringify(consoleErrors));

  await page.screenshot({ path: path.join(DIR, 'demo_after_save_desktop.png'), fullPage: true });

  // ---- Refresh: confirm changes persisted (localStorage) ----
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  await page.fill('#search-input', 'AI Sriracha');
  await page.waitForTimeout(150);
  const cardTextAfterReload = await page.$eval('.paper-card', el => el.textContent);
  assert(cardTextAfterReload.includes('Edited'), 'Edited flag survives a page refresh (localStorage persisted)');
  await page.click('[data-open-detail]');
  await page.waitForTimeout(150);
  const detailAfterReload = await page.$eval('.detail-panel', el => el.textContent);
  assert(detailAfterReload.includes('Demo Test Journal'), 'Logged submission survives a page refresh');
  assert(detailAfterReload.includes('Drafting'), 'Stage edit survives a page refresh');

  // ---- Second-session name reuse: name field should be pre-filled ----
  await page.click('.detail-panel [data-open-edit]');
  await page.waitForTimeout(150);
  const nameFieldValue = await page.$eval('.detail-panel input[id$="-name"]', el => el.value);
  assert(nameFieldValue === 'Jane Demo', 'Name field is pre-filled from sessionStorage on a later edit in the same tab, got: ' + nameFieldValue);
  await page.click('.detail-panel [data-cancel-edit]');
  await page.waitForTimeout(100);

  // ---- Reset demo data ----
  page.on('dialog', d => d.accept());
  await page.click('#reset-demo-btn');
  await page.waitForTimeout(500);
  await page.fill('#search-input', 'AI Sriracha');
  await page.waitForTimeout(150);
  const cardAfterReset = await page.$eval('.paper-card', el => el.textContent);
  assert(!cardAfterReset.includes('Edited'), 'After Reset demo data, the Edited flag is gone (back to original data)');
  await page.click('[data-open-detail]');
  await page.waitForTimeout(150);
  const detailAfterReset = await page.$eval('.detail-panel', el => el.textContent);
  assert(!detailAfterReset.includes('Demo Test Journal'), 'After Reset, the logged demo submission is gone');
  assert(!detailAfterReset.includes('demo-edited-draft'), 'After Reset, the draft link edit is gone');
  const localStorageAfterReset = await page.evaluate(() => localStorage.getItem('labledger_demo_edits'));
  assert(localStorageAfterReset === null, 'Reset actually cleared localStorage');

  await page.close();

  // ================= "Copy my changes as JSON" =================
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await clearStorage(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('#search-input', 'Before You Build');
  await page.waitForTimeout(150);
  await page.click('[data-open-detail]');
  await page.waitForTimeout(150);
  await page.click('.detail-panel [data-open-edit]');
  await page.waitForTimeout(150);
  await page.fill('.detail-panel input[id$="-name"]', 'Copy Tester');
  await page.selectOption('.detail-panel select[id$="-priority"]', 'High');
  await page.click('.detail-panel [data-save-edit]');
  await page.waitForTimeout(1200);

  await page.click('#copy-demo-btn');
  await page.waitForTimeout(150);
  const overlayOpen = await page.$eval('#copy-json-overlay', el => el.classList.contains('open'));
  assert(overlayOpen, 'Copy-JSON overlay opens');
  const jsonText = await page.$eval('#copy-json-text', el => el.value);
  const parsed = JSON.parse(jsonText);
  // Copy-JSON's top-level shape is {edits, added, deleted} — added/deleted
  // were introduced alongside create/delete support; see test_create_delete.js.
  assert(parsed.edits && parsed.edits['P006'] && parsed.edits['P006'].fields.priority === 'High', 'Copy-JSON dump contains the real edit, got: ' + jsonText.slice(0, 250));
  assert(parsed.edits['P006'].editedBy === 'Copy Tester', 'Copy-JSON dump attributes the edit to the entered name');
  await page.click('#copy-json-close');
  await page.waitForTimeout(100);
  const overlayClosed = await page.$eval('#copy-json-overlay', el => !el.classList.contains('open'));
  assert(overlayClosed, 'Copy-JSON overlay closes');
  await page.close();

  // ================= Demo banner: visible, non-blocking =================
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await clearStorage(page);
  await page.reload({ waitUntil: 'networkidle' });
  const totalCount = await page.$eval('.kpi-card .num', el => el.textContent.trim());
  const bannerVisible = await page.$eval('#demo-banner', el => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && getComputedStyle(el).display !== 'none';
  });
  assert(bannerVisible, 'Demo banner is visible on load');
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(100);
  const bannerStillVisible = await page.$eval('#demo-banner', el => el.getBoundingClientRect().top >= 0 && el.getBoundingClientRect().top < 100);
  assert(bannerStillVisible, 'Demo banner stays visible (sticky) after scrolling');
  await page.fill('#search-input', 'AI Sriracha');
  const searchWorks = await page.$eval('#search-input', el => el.value === 'AI Sriracha');
  assert(searchWorks, 'Search input still receives focus/input with the banner present (not blocking interaction)');
  await page.waitForTimeout(150);
  const resultCountText = await page.$eval('#result-count', el => el.textContent);
  assert(resultCountText.startsWith('1 of ' + totalCount), 'Filtering still works normally with the banner present, got: ' + resultCountText);
  await page.close();

  // ================= MOBILE =================
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const mobileErrors = [];
  page.on('console', m => { if (m.type() === 'error') mobileErrors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await clearStorage(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(DIR, 'demo_closed_mobile.png'), fullPage: true });

  await page.fill('#search-input', 'AI Sriracha');
  await page.waitForTimeout(150);
  await page.click('[data-open-detail]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(DIR, 'demo_detail_view_mobile.png'), fullPage: true });

  const mobileScrollW1 = await page.evaluate(() => document.documentElement.scrollWidth);
  const mobileClientW1 = await page.evaluate(() => document.documentElement.clientWidth);
  assert(mobileScrollW1 <= mobileClientW1 + 2, 'No horizontal overflow with detail view open on mobile (scrollWidth=' + mobileScrollW1 + ' clientWidth=' + mobileClientW1 + ')');

  await page.click('.detail-panel [data-open-edit]');
  await page.waitForTimeout(150);
  await page.fill('.detail-panel input[id$="-name"]', 'Mobile Tester');
  await page.selectOption('.detail-panel select[id$="-stage"]', 'Internal Review');
  await page.screenshot({ path: path.join(DIR, 'demo_edit_form_mobile.png'), fullPage: true });

  const mobileScrollW2 = await page.evaluate(() => document.documentElement.scrollWidth);
  const mobileClientW2 = await page.evaluate(() => document.documentElement.clientWidth);
  assert(mobileScrollW2 <= mobileClientW2 + 2, 'No horizontal overflow with edit form open on mobile (scrollWidth=' + mobileScrollW2 + ' clientWidth=' + mobileClientW2 + ')');

  await page.click('.detail-panel [data-save-edit]');
  await page.waitForTimeout(1200);
  const mobileReadText = await page.$eval('.detail-panel', el => el.textContent);
  assert(mobileReadText.includes('Internal Review'), 'Mobile edit saved correctly, read view shows Internal Review');

  assert(mobileErrors.length === 0, 'No console errors on mobile, got: ' + JSON.stringify(mobileErrors));
  await page.close();

  await browser.close();
  console.log('\nALL DEMO MODE TESTS PASSED');
})().catch(err => { console.error(err); process.exit(1); });
