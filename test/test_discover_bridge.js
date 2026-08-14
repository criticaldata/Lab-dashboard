// Regression suite for the index.html -> discover.html demo bridge: a
// project created in demo mode with "Open to new members" checked should
// actually show up on the public Discover page — but ONLY in the same
// browser (same origin, shared localStorage), flagged as a demo addition,
// never as a real network fetch of data.json, and never visible to a
// different visitor (a fresh browser context/incognito-equivalent).
//
// This exists because "created a project on index.html, checked Open to
// new members, went to discover.html, and it wasn't there" was reported as
// a bug — demo mode is supposed to feel complete end to end, not stop
// halfway between the two pages.
//
// Prerequisites: serve this folder locally first (from the repo root):
//   python3 -m http.server 8000
// then: node test/test_discover_bridge.js
const { chromium } = require('playwright');
const path = require('path');

const INDEX = 'http://localhost:8000/index.html';
const DISCOVER = 'http://localhost:8000/discover.html';
const DIR = path.join(__dirname, 'screenshots');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('OK: ' + msg);
}

async function clearStorage(page) {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
}

async function createProject(page, { title, owner, open }) {
  await page.click('#new-project-btn');
  await page.waitForTimeout(150);
  await page.fill('#new-project-title', title);
  await page.fill('#new-project-name', 'Bridge Tester');
  await page.fill('#new-project-abstract', 'A project created by the demo-bridge test suite.');
  await page.fill('#new-project-tags', 'bridge testing');
  if (owner) await page.fill('#new-project-owner', owner);
  if (open) await page.check('#new-project-open');
  await page.click('#new-project-save');
  await page.waitForTimeout(300);
}

(async () => {
  const browser = await chromium.launch();

  // ================= PART 1: an open project bridges through =================
  const context = await browser.newContext();
  let page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(INDEX, { waitUntil: 'networkidle' });
  await clearStorage(page);
  await page.reload({ waitUntil: 'networkidle' });

  await createProject(page, { title: 'Bridge Open Project', owner: 'Bridge Owner', open: true });

  const requestUrls = [];
  page.on('request', r => requestUrls.push(r.url()));

  await page.goto(DISCOVER, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);

  const cardTitles = await page.$$eval('.project-card h3', els => els.map(e => e.textContent));
  console.log('Discover card titles:', cardTitles);
  assert(cardTitles.includes('Bridge Open Project'), 'A demo-created open project actually appears on discover.html, got: ' + JSON.stringify(cardTitles));

  const badgeText = await page.$eval('.demo-local-badge', el => el.textContent);
  assert(/demo session/i.test(badgeText), 'The bridged card is flagged as a demo addition, got: ' + badgeText);

  const noteText = await page.$eval('.demo-local-note', el => el.textContent);
  assert(/1 project/i.test(noteText) && /not a real publish/i.test(noteText), 'The result-count area explains this is a local demo echo, not a real publish, got: ' + noteText);

  await page.screenshot({ path: path.join(DIR, 'discover_bridge_open_project.png'), fullPage: true });

  // Still zero requests to data.json — the bridge is a localStorage read, never a fetch.
  const touchedRealData = requestUrls.some(u => { try { return new URL(u).pathname.endsWith('/data.json'); } catch (e) { return false; } });
  assert(!touchedRealData, 'Bridging in the demo project still made zero requests to data.json');

  assert(errors.length === 0, 'No console errors bridging a project through to discover.html, got: ' + JSON.stringify(errors));

  // ================= PART 2: a fresh visitor (new browser context) never sees it =================
  const strangerContext = await browser.newContext();
  const strangerPage = await strangerContext.newPage();
  await strangerPage.goto(DISCOVER, { waitUntil: 'networkidle' });
  await strangerPage.waitForTimeout(250);
  const strangerTitles = await strangerPage.$$eval('.project-card h3', els => els.map(e => e.textContent));
  assert(!strangerTitles.includes('Bridge Open Project'), 'A different browser/visitor does NOT see the demo-bridged project — this is a local echo, not a real publish');
  await strangerContext.close();

  // ================= PART 3: a NON-open project does NOT bridge =================
  await page.goto(INDEX, { waitUntil: 'networkidle' });
  await createProject(page, { title: 'Bridge Closed Project', owner: 'Bridge Owner', open: false });
  await page.goto(DISCOVER, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  const titlesAfterClosedCreate = await page.$$eval('.project-card h3', els => els.map(e => e.textContent));
  assert(!titlesAfterClosedCreate.includes('Bridge Closed Project'), 'A demo project WITHOUT "Open to new members" checked does not bridge to discover.html');
  assert(titlesAfterClosedCreate.includes('Bridge Open Project'), 'The earlier open project is still there');

  // ================= PART 4: deleting it removes it from discover.html too =================
  await page.goto(INDEX, { waitUntil: 'networkidle' });
  await page.fill('#search-input', 'Bridge Open Project');
  await page.waitForTimeout(200);
  await page.click('[data-open-detail]');
  await page.waitForTimeout(150);
  await page.click('.detail-panel [data-open-edit]');
  await page.waitForTimeout(150);
  await page.click('.detail-panel [data-open-delete]');
  await page.waitForTimeout(150);
  await page.click('.detail-panel [data-confirm-delete]');
  await page.waitForTimeout(200);

  await page.goto(DISCOVER, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  const titlesAfterDelete = await page.$$eval('.project-card h3', els => els.map(e => e.textContent));
  assert(!titlesAfterDelete.includes('Bridge Open Project'), 'Deleting the demo project on index.html removes it from discover.html too, got: ' + JSON.stringify(titlesAfterDelete));

  await context.close();

  // ================= MOBILE =================
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await mobileContext.newPage();
  const mobileErrors = [];
  page.on('console', m => { if (m.type() === 'error') mobileErrors.push(m.text()); });
  await page.goto(INDEX, { waitUntil: 'networkidle' });
  await clearStorage(page);
  await page.reload({ waitUntil: 'networkidle' });
  await createProject(page, { title: 'Bridge Mobile Project', owner: 'Mobile Owner', open: true });
  await page.goto(DISCOVER, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  const mobileTitles = await page.$$eval('.project-card h3', els => els.map(e => e.textContent));
  assert(mobileTitles.includes('Bridge Mobile Project'), 'Bridged project also appears on mobile discover.html');
  await page.screenshot({ path: path.join(DIR, 'discover_bridge_mobile.png'), fullPage: true });
  const mobileScrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  const mobileClientW = await page.evaluate(() => document.documentElement.clientWidth);
  assert(mobileScrollW <= mobileClientW + 2, 'No horizontal overflow on mobile with a bridged card (scrollWidth=' + mobileScrollW + ' clientWidth=' + mobileClientW + ')');
  assert(mobileErrors.length === 0, 'No console errors on mobile, got: ' + JSON.stringify(mobileErrors));
  await mobileContext.close();

  await browser.close();
  console.log('\nALL DISCOVER-BRIDGE TESTS PASSED');
})().catch(err => { console.error(err); process.exit(1); });
