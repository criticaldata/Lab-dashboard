// Regression suite for demo-mode create/delete: adding a new project via
// the "+ New Project" form, its "New (not yet shared)" indicator,
// persistence across refresh, deleting it outright; deleting a real
// (data.json-sourced) paper (hidden, not removed from data.json), Reset
// demo data bringing it back; "Copy my changes as JSON" including both an
// added paper and a deleted id; mobile width.
//
// Prerequisites: serve this folder locally first (from the repo root):
//   python3 -m http.server 8000
// then: node test/test_create_delete.js
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

// Creating (or saving an edit to) a paper leaves its detail panel
// auto-opened, by design, so the presenter immediately sees the result —
// so a plain click on the title would sometimes TOGGLE IT CLOSED instead
// of opening it. Only click if it isn't already open.
async function ensureDetailOpen(page) {
  const alreadyOpen = await page.$eval('.detail-panel', el => el.classList.contains('open')).catch(() => false);
  if (!alreadyOpen) {
    await page.click('[data-open-detail]');
    await page.waitForTimeout(150);
  }
}

async function freshPage(browser, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 1280, height: 1000 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await clearStorage(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  return { page, errors };
}

(async () => {
  const browser = await chromium.launch();

  // ================= PART 1: create a new project =================
  let { page, errors } = await freshPage(browser);

  await page.click('#new-project-btn');
  await page.waitForTimeout(150);
  const overlayOpen = await page.$eval('#new-project-overlay', el => el.classList.contains('open'));
  assert(overlayOpen, 'New Project modal opens');

  await page.screenshot({ path: path.join(DIR, 'createdelete_new_project_form.png'), fullPage: true });

  // Validation: empty title is rejected
  await page.fill('#new-project-name', 'Creator One');
  await page.click('#new-project-save');
  await page.waitForTimeout(150);
  const stillOpenAfterEmptyTitle = await page.$eval('#new-project-overlay', el => el.classList.contains('open'));
  assert(stillOpenAfterEmptyTitle, 'Saving with an empty title is rejected (modal stays open)');

  await page.fill('#new-project-title', 'Playwright Test Project');
  await page.selectOption('#new-project-stage', 'Idea');
  await page.selectOption('#new-project-priority', 'Medium');
  await page.fill('#new-project-abstract', 'A project created entirely by the automated test suite.');
  await page.fill('#new-project-tags', 'testing, automation');
  await page.fill('#new-project-skills', 'patience');
  await page.check('#new-project-open');
  await page.fill('#new-project-targetvenue', 'Journal of Automated Testing');
  await page.click('#new-project-save');
  await page.waitForTimeout(500);

  const overlayClosedAfterSave = await page.$eval('#new-project-overlay', el => !el.classList.contains('open'));
  assert(overlayClosedAfterSave, 'Modal closes after a successful save');

  await page.fill('#search-input', 'Playwright Test Project');
  await page.waitForTimeout(200);
  const cardCount = await page.$$eval('.paper-card', els => els.length);
  assert(cardCount === 1, 'The new project renders as a card, got ' + cardCount);

  const cardText = await page.$eval('.paper-card', el => el.textContent);
  assert(cardText.includes('New (not yet shared)'), 'New card shows the "New (not yet shared)" indicator');
  assert(cardText.includes('Idea') || cardText.includes('Waiting'), 'Card reflects the chosen stage in its status, got: ' + cardText.slice(0, 150));

  const newId = await page.$eval('[data-open-detail]', el => {
    const card = el.closest('.paper-card');
    return card ? card.querySelector('.new-flag') && true : false;
  });
  assert(newId === true, 'The new-flag element is actually present on the card DOM');

  await page.screenshot({ path: path.join(DIR, 'createdelete_new_card.png'), fullPage: true });

  assert(errors.length === 0, 'No console errors during project creation, got: ' + JSON.stringify(errors));

  // ---- Persistence across refresh ----
  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('#search-input', 'Playwright Test Project');
  await page.waitForTimeout(200);
  const cardAfterReload = await page.$eval('.paper-card', el => el.textContent).catch(() => null);
  assert(cardAfterReload && cardAfterReload.includes('New (not yet shared)'), 'New project survives a page refresh');

  // ---- Delete the locally-added project ----
  await page.click('[data-open-detail]');
  await page.waitForTimeout(150);
  await page.click('.detail-panel [data-open-edit]');
  await page.waitForTimeout(150);
  const deleteLink = await page.$('.detail-panel [data-open-delete]');
  assert(deleteLink !== null, '"Delete this project…" link exists in the edit view');
  await deleteLink.click();
  await page.waitForTimeout(150);

  const confirmVisible = await page.$eval('.detail-panel .delete-confirm', el => el.textContent);
  console.log('Delete confirm text (added paper):', confirmVisible);
  assert(confirmVisible.includes('only created in this demo session'), 'Confirmation text correctly says this paper only exists locally: ' + confirmVisible);

  await page.screenshot({ path: path.join(DIR, 'createdelete_confirm_step.png'), fullPage: true });

  // Cancel first, confirm it's NOT deleted
  await page.click('.detail-panel [data-cancel-delete]');
  await page.waitForTimeout(150);
  const stillThereAfterCancel = await page.$('.detail-panel [data-open-delete]');
  assert(stillThereAfterCancel !== null, 'Clicking Cancel on the delete confirmation does NOT delete the paper');

  // Now actually delete it
  await page.click('.detail-panel [data-open-delete]');
  await page.waitForTimeout(150);
  await page.click('.detail-panel [data-confirm-delete]');
  await page.waitForTimeout(300);

  const emptyStateAfterDelete = await page.$('.empty-state');
  assert(emptyStateAfterDelete !== null, 'The added project is gone immediately after confirming delete');

  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('#search-input', 'Playwright Test Project');
  await page.waitForTimeout(200);
  const stillGoneAfterReload = await page.$('.empty-state');
  assert(stillGoneAfterReload !== null, 'The deleted (locally-added) project is still gone after a refresh');

  await page.close();

  // ================= PART 2: delete a REAL paper, then Reset =================
  ({ page, errors } = await freshPage(browser));

  await page.fill('#search-input', 'AI Sriracha');
  await page.waitForTimeout(200);
  await page.click('[data-open-detail]');
  await page.waitForTimeout(150);
  await page.click('.detail-panel [data-open-edit]');
  await page.waitForTimeout(150);
  await page.click('.detail-panel [data-open-delete]');
  await page.waitForTimeout(150);
  const realConfirmText = await page.$eval('.detail-panel .delete-confirm', el => el.textContent);
  console.log('Delete confirm text (real paper):', realConfirmText);
  assert(realConfirmText.includes('stays in the real data.json'), 'Confirmation text correctly says the real record is untouched: ' + realConfirmText);
  await page.click('.detail-panel [data-confirm-delete]');
  await page.waitForTimeout(300);

  const emptyStateAfterRealDelete = await page.$('.empty-state');
  assert(emptyStateAfterRealDelete !== null, 'AI Sriracha disappears from the rendered list after deleting');

  // Confirm data.json itself is untouched (fetch it directly, bypassing demo-mode merge)
  const rawDataStillHasIt = await page.evaluate(async () => {
    const res = await fetch('data.json');
    const data = await res.json();
    return data.papers.some(p => p.title.includes('AI Sriracha'));
  });
  assert(rawDataStillHasIt, 'The real data.json file itself still contains AI Sriracha — only the rendered view hid it');

  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('#search-input', 'AI Sriracha');
  await page.waitForTimeout(200);
  const stillHiddenAfterReload = await page.$('.empty-state');
  assert(stillHiddenAfterReload !== null, 'The hidden real paper stays hidden after a refresh (deleted-list persisted)');

  page.on('dialog', d => d.accept());
  await page.click('#reset-demo-btn');
  await page.waitForTimeout(500);
  await page.fill('#search-input', 'AI Sriracha');
  await page.waitForTimeout(200);
  const backAfterReset = await page.$('.paper-card');
  assert(backAfterReset !== null, 'AI Sriracha reappears after "Reset demo data"');

  assert(errors.length === 0, 'No console errors during the delete/reset flow, got: ' + JSON.stringify(errors));
  await page.close();

  // ================= PART 3: "Copy my changes as JSON" includes added + deleted =================
  ({ page, errors } = await freshPage(browser));

  // Add one project
  await page.click('#new-project-btn');
  await page.waitForTimeout(150);
  await page.fill('#new-project-title', 'Copy Test Project');
  await page.fill('#new-project-name', 'Copy Tester');
  await page.click('#new-project-save');
  await page.waitForTimeout(500);

  // Delete a different, real project
  await page.fill('#search-input', 'Before You Build');
  await page.waitForTimeout(200);
  await page.click('[data-open-detail]');
  await page.waitForTimeout(150);
  await page.click('.detail-panel [data-open-edit]');
  await page.waitForTimeout(150);
  await page.click('.detail-panel [data-open-delete]');
  await page.waitForTimeout(150);
  await page.click('.detail-panel [data-confirm-delete]');
  await page.waitForTimeout(300);
  await page.fill('#search-input', '');
  await page.waitForTimeout(150);

  await page.click('#copy-demo-btn');
  await page.waitForTimeout(150);
  const jsonText = await page.$eval('#copy-json-text', el => el.value);
  const parsed = JSON.parse(jsonText);
  console.log('Copy-JSON dump keys:', Object.keys(parsed));
  assert(Array.isArray(parsed.added) && parsed.added.length === 1, 'Copy-JSON output includes the added project, got: ' + JSON.stringify(parsed.added && parsed.added.length));
  assert(parsed.added[0].title === 'Copy Test Project', 'Added project in the dump has the right title');
  assert(Array.isArray(parsed.deleted) && parsed.deleted.includes('P006'), 'Copy-JSON output includes the deleted id P006 (Before You Build), got: ' + JSON.stringify(parsed.deleted));
  assert(typeof parsed.edits === 'object', 'Copy-JSON output still includes the edits layer');

  assert(errors.length === 0, 'No console errors during the copy-JSON test, got: ' + JSON.stringify(errors));
  await page.close();

  // ================= MOBILE =================
  ({ page, errors } = await freshPage(browser, { width: 390, height: 844 }));

  await page.click('#new-project-btn');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(DIR, 'createdelete_new_project_form_mobile.png'), fullPage: true });
  const mobileScrollW1 = await page.evaluate(() => document.documentElement.scrollWidth);
  const mobileClientW1 = await page.evaluate(() => document.documentElement.clientWidth);
  assert(mobileScrollW1 <= mobileClientW1 + 2, 'No horizontal overflow with New Project modal open on mobile (scrollWidth=' + mobileScrollW1 + ' clientWidth=' + mobileClientW1 + ')');

  await page.fill('#new-project-title', 'Mobile New Project');
  await page.fill('#new-project-name', 'Mobile Tester');
  await page.click('#new-project-save');
  await page.waitForTimeout(500);

  await page.fill('#search-input', 'Mobile New Project');
  await page.waitForTimeout(200);
  await ensureDetailOpen(page);
  await page.click('.detail-panel [data-open-edit]');
  await page.waitForTimeout(150);
  await page.click('.detail-panel [data-open-delete]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(DIR, 'createdelete_confirm_step_mobile.png'), fullPage: true });
  const mobileScrollW2 = await page.evaluate(() => document.documentElement.scrollWidth);
  const mobileClientW2 = await page.evaluate(() => document.documentElement.clientWidth);
  assert(mobileScrollW2 <= mobileClientW2 + 2, 'No horizontal overflow with delete confirm open on mobile (scrollWidth=' + mobileScrollW2 + ' clientWidth=' + mobileClientW2 + ')');
  await page.click('.detail-panel [data-confirm-delete]');
  await page.waitForTimeout(300);
  const mobileEmptyState = await page.$('.empty-state');
  assert(mobileEmptyState !== null, 'Delete works correctly on mobile');

  assert(errors.length === 0, 'No console errors on mobile, got: ' + JSON.stringify(errors));
  await page.close();

  await browser.close();
  console.log('\nALL CREATE/DELETE TESTS PASSED');
})().catch(err => { console.error(err); process.exit(1); });
