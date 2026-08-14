// Functional test for discover.html: only openToNewMembers papers appear,
// keyword matching/sorting responds to the typed interest, "I'm interested"
// produces a correct mailto link, mobile width works, and the page never
// requests data.json (only the public file).
//
// Prerequisites: serve this folder locally first (from the repo root):
//   python3 -m http.server 8000
// then, with Playwright installed (npm install playwright in this test/
// folder, or npx playwright if you don't want a local install):
//   node test/test_discover.js
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:8000/discover.html?data=data.sample.public.json';
const DIR = path.join(__dirname, 'screenshots');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('OK: ' + msg);
}

(async () => {
  const browser = await chromium.launch();

  // ================= Desktop: empty search state =================
  let page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

  const requestUrls = [];
  page.on('request', r => requestUrls.push(r.url()));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);

  const cardCount = await page.$$eval('.project-card', els => els.length);
  assert(cardCount === 3, 'Only the 3 openToNewMembers fixture papers appear, got ' + cardCount);

  const titles = await page.$$eval('.project-card h3', els => els.map(e => e.textContent));
  console.log('Titles shown:', titles);
  assert(!titles.some(t => t.includes('Overdue') || t.includes('Two Submission') || t.includes('Revise') || t.includes('Accepted') || t.includes('Published')), 'None of the closed (openToNewMembers:false) papers appear');

  const resultCountText = await page.$eval('#result-count', el => el.textContent);
  assert(resultCountText.includes('3 open project'), 'Result count reflects 3 open projects, got: ' + resultCountText);

  const noteText = await page.$eval('.matching-note', el => el.textContent);
  assert(noteText.includes('Basic keyword matching'), 'Page plainly labels the matching as basic/temporary');

  await page.screenshot({ path: path.join(DIR, 'discover_empty_search_desktop.png'), fullPage: true });

  // ================= Network isolation: never touches data.json =================
  const touchedRealData = requestUrls.some(u => {
    try { return new URL(u).pathname.endsWith('/data.json'); } catch (e) { return false; }
  });
  assert(!touchedRealData, 'discover.html made zero requests to data.json (real internal data), only data.public.json/data.sample.public.json');
  const touchedPublicData = requestUrls.some(u => u.includes('data.sample.public.json'));
  assert(touchedPublicData, 'discover.html did fetch the public data file');

  // ================= Typing an interest: matching + sorting =================
  await page.fill('#interest-input', 'I like machine learning and public health policy');
  await page.waitForTimeout(150);

  const orderedTitlesAfterQuery = await page.$$eval('.project-card h3', els => els.map(e => e.textContent));
  console.log('Order after "machine learning / public health policy":', orderedTitlesAfterQuery);
  assert(orderedTitlesAfterQuery[0].includes('Mid-Draft'), 'The ML/public-health paper (S002) sorts first for that exact query, got: ' + orderedTitlesAfterQuery[0]);

  const bestMatchCount = await page.$$eval('.project-card.best-match', els => els.length);
  assert(bestMatchCount >= 1, 'At least one card is visually flagged as a best match');

  await page.screenshot({ path: path.join(DIR, 'discover_matched_search_desktop.png'), fullPage: true });

  // Different interest -> different top result
  await page.fill('#interest-input', 'clinical trials and statistics');
  await page.waitForTimeout(150);
  const orderedTitles2 = await page.$$eval('.project-card h3', els => els.map(e => e.textContent));
  console.log('Order after "clinical trials and statistics":', orderedTitles2);
  assert(orderedTitles2[0].includes('Out for Review'), 'The clinical-trials paper (S005) sorts first for that query, got: ' + orderedTitles2[0]);

  // A nonsense query should still show all 3 (sorted, all score 0) rather than an empty state
  await page.fill('#interest-input', 'xyznonsensequery');
  await page.waitForTimeout(150);
  const cardCountNonsense = await page.$$eval('.project-card', els => els.length);
  assert(cardCountNonsense === 3, 'A query matching nothing still shows all open projects (sorted, not filtered/hidden), got ' + cardCountNonsense);

  // Clear query -> back to original order/count
  await page.fill('#interest-input', '');
  await page.waitForTimeout(150);
  const cardCountCleared = await page.$$eval('.project-card', els => els.length);
  assert(cardCountCleared === 3, 'Clearing the query still shows all 3');

  assert(consoleErrors.length === 0, 'No console errors on discover.html, got: ' + JSON.stringify(consoleErrors));

  // ================= "I'm interested" mailto link =================
  await page.fill('#interest-input', 'machine learning');
  await page.waitForTimeout(150);
  const firstCard = await page.$('.project-card');
  const mailHref = await firstCard.$eval('[data-interested-link]', el => el.getAttribute('href'));
  console.log('mailto href:', mailHref);
  assert(mailHref.startsWith('mailto:'), 'Interested button is a real mailto: link');
  assert(mailHref.includes('subject=Interested%20in%3A'), 'mailto subject is pre-filled with "Interested in: ", got: ' + mailHref);
  assert(mailHref.includes('%40') || mailHref.includes('@'), 'mailto address looks like an email: ' + mailHref);

  const navHref = await page.$eval('header.site nav a', el => el.getAttribute('href'));
  assert(navHref === 'index.html', 'Discover page links back to the full dashboard, got: ' + navHref);

  await page.close();

  // ================= index.html -> discover.html nav link =================
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:8000/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  const discoverNavHref = await page.$eval('header.site nav a', el => el.getAttribute('href'));
  assert(discoverNavHref === 'discover.html', 'Main dashboard links to discover.html, got: ' + discoverNavHref);
  await page.close();

  // ================= Mobile =================
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const mobileErrors = [];
  page.on('console', m => { if (m.type() === 'error') mobileErrors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(DIR, 'discover_empty_search_mobile.png'), fullPage: true });

  await page.fill('#interest-input', 'machine learning and public health policy');
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(DIR, 'discover_matched_search_mobile.png'), fullPage: true });

  const mobileScrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  const mobileClientW = await page.evaluate(() => document.documentElement.clientWidth);
  assert(mobileScrollW <= mobileClientW + 2, 'No horizontal overflow on mobile (scrollWidth=' + mobileScrollW + ' clientWidth=' + mobileClientW + ')');
  assert(mobileErrors.length === 0, 'No console errors on mobile, got: ' + JSON.stringify(mobileErrors));
  await page.close();

  // ================= Real data.public.json -> renders fine, no crash =================
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const realDataErrors = [];
  page.on('console', m => { if (m.type() === 'error') realDataErrors.push(m.text()); });
  await page.goto('http://localhost:8000/discover.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  const hasCardsOrEmptyState = await page.evaluate(() => {
    return document.querySelectorAll('.project-card').length > 0 || !!document.querySelector('.empty-state');
  });
  assert(hasCardsOrEmptyState, 'Real data.public.json renders either projects or a friendly empty state, not a crash');
  assert(realDataErrors.length === 0, 'No console errors against the real data.public.json, got: ' + JSON.stringify(realDataErrors));
  await page.close();

  await browser.close();
  console.log('\nALL DISCOVER.HTML TESTS PASSED');
})().catch(err => { console.error(err); process.exit(1); });
