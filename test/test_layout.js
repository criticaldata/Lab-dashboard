// Regression suite for the card-grid/rails layout redesign: the
// multi-column card grid (and that an expanded card spans the full grid
// width instead of squeezing into one column), the left-rail stage/
// status/open-to-new-members filters (and that they combine correctly
// with the existing search box and KPI-click filtering, not replace
// them), the right-rail "Upcoming deadlines" / "Recently updated or
// added" widgets, the slimmer dismissible demo-mode banner, and the new
// WhatsApp-link / team-member-with-LinkedIn fields on both pages.
//
// Prerequisites: serve this folder locally first (from the repo root):
//   python3 -m http.server 8000
// then: node test/test_layout.js
const { chromium } = require('playwright');
const path = require('path');

const INDEX = 'http://localhost:8000/index.html';
const DISCOVER = 'http://localhost:8000/discover.html';
const DIR = path.join(__dirname, 'screenshots');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('OK: ' + msg);
}

async function freshPage(browser, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(INDEX, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  return { page, errors };
}

(async () => {
  const browser = await chromium.launch();

  // ================= Card grid: multi-column at desktop =================
  let { page, errors } = await freshPage(browser, { width: 1680, height: 1000 });

  const gridColumnCount = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('paper-list'));
    return cs.gridTemplateColumns.split(' ').length;
  });
  assert(gridColumnCount >= 2, 'Card grid renders at least 2 columns at 1680px width, got ' + gridColumnCount);

  const firstCardBox = await page.$eval('.paper-card', el => el.getBoundingClientRect());
  const listBox = await page.$eval('#paper-list', el => el.getBoundingClientRect());
  assert(firstCardBox.width < listBox.width * 0.9, 'A single card does not span the full list width (real multi-column grid, not a disguised single column), card=' + Math.round(firstCardBox.width) + ' list=' + Math.round(listBox.width));

  const cardStyle = await page.$eval('.paper-card', el => {
    const cs = getComputedStyle(el);
    return { border: cs.borderWidth, radius: cs.borderRadius, padding: cs.paddingTop, shadow: cs.boxShadow };
  });
  assert(parseFloat(cardStyle.border) > 0, 'Cards have a visible border, got ' + cardStyle.border);
  assert(parseFloat(cardStyle.radius) >= 8, 'Cards have rounded corners, got ' + cardStyle.radius);
  assert(parseFloat(cardStyle.padding) >= 14, 'Cards have generous internal padding, got ' + cardStyle.padding);
  assert(cardStyle.shadow !== 'none', 'Cards have a shadow for visual presence, got ' + cardStyle.shadow);

  // Hover lift
  const beforeTransform = await page.$eval('.paper-card', el => getComputedStyle(el).transform);
  await page.hover('.paper-card');
  await page.waitForTimeout(200);
  const afterTransform = await page.$eval('.paper-card', el => getComputedStyle(el).transform);
  assert(beforeTransform !== afterTransform, 'Hovering a card changes its transform (lift effect), before=' + beforeTransform + ' after=' + afterTransform);

  // Expanded card spans the full grid width
  await page.click('[data-open-detail]');
  await page.waitForTimeout(250);
  const expandedBox = await page.$eval('.paper-card.expanded', el => el.getBoundingClientRect());
  const listBox2 = await page.$eval('#paper-list', el => el.getBoundingClientRect());
  assert(Math.abs(expandedBox.width - listBox2.width) < 2, 'An expanded card spans the FULL grid width instead of being squeezed into one narrow column, expanded=' + Math.round(expandedBox.width) + ' list=' + Math.round(listBox2.width));
  await page.screenshot({ path: path.join(DIR, 'layout_expanded_card_full_width.png'), fullPage: true });
  await page.click('.detail-close');
  await page.waitForTimeout(150);

  assert(errors.length === 0, 'No console errors so far, got: ' + JSON.stringify(errors));
  await page.close();

  // ================= Left-rail filters: solo + combined with search/KPI =================
  ({ page, errors } = await freshPage(browser, { width: 1680, height: 1000 }));

  // Stage filter alone
  const draftingChip = await page.locator('.filter-chip', { hasText: 'Drafting' }).first();
  await draftingChip.click();
  await page.waitForTimeout(150);
  let resultText = await page.$eval('#result-count', el => el.textContent);
  console.log('After Drafting stage filter:', resultText);
  const draftingCountMatch = resultText.match(/^(\d+) of/);
  assert(draftingCountMatch !== null, 'Result count updates after a stage filter, got: ' + resultText);
  const cardStages = await page.$$eval('.paper-card .meta-item', els => els.map(e => e.textContent));
  assert(cardStages.every(t => !t.startsWith('Stage:') || t.includes('Drafting')), 'Every visible card is actually in the Drafting stage after filtering');

  // Combine with search box: stage filter + text search together (AND, not OR)
  await page.fill('#search-input', 'AI');
  await page.waitForTimeout(150);
  resultText = await page.$eval('#result-count', el => el.textContent);
  console.log('Drafting + search "AI":', resultText);
  const combinedCount = parseInt(resultText.match(/^(\d+) of/)[1], 10);
  assert(combinedCount <= parseInt(draftingCountMatch[1], 10), 'Adding a search term on top of a stage filter narrows (or holds steady), never widens, the result — stage-only=' + draftingCountMatch[1] + ' combined=' + combinedCount);
  const stageChipStillActive = await draftingChip.evaluate(el => el.classList.contains('active'));
  assert(stageChipStillActive, 'The stage filter chip stays active while also searching (both filters combine, search does not clear it)');

  // Combine with KPI strip too: click a KPI on top of stage+search.
  // renderKpis() replaces the KPI row's innerHTML on every render, so a
  // stale ElementHandle from before the stage-filter click would detach —
  // use a Locator (re-queries live) instead.
  const preSubKpi = page.locator('.kpi-card').nth(1); // Pre-Submission
  await preSubKpi.click();
  await page.waitForTimeout(150);
  resultText = await page.$eval('#result-count', el => el.textContent);
  console.log('Drafting + search "AI" + Pre-Submission KPI:', resultText);
  await page.screenshot({ path: path.join(DIR, 'layout_combined_filters.png'), fullPage: true });
  await preSubKpi.click(); // clear KPI again
  await page.fill('#search-input', '');
  await draftingChip.click(); // toggle off
  await page.waitForTimeout(150);
  resultText = await page.$eval('#result-count', el => el.textContent);
  assert(/^30 of 30/.test(resultText), 'Clearing every filter restores the full list, got: ' + resultText);

  // Toggling the same chip again clears it (same interaction as the KPI strip)
  await draftingChip.click();
  await page.waitForTimeout(100);
  const activeAfterFirstClick = await draftingChip.evaluate(el => el.classList.contains('active'));
  assert(activeAfterFirstClick, 'Clicking a filter chip activates it');
  await draftingChip.click();
  await page.waitForTimeout(100);
  const activeAfterSecondClick = await draftingChip.evaluate(el => el.classList.contains('active'));
  assert(!activeAfterSecondClick, 'Clicking the same filter chip again deactivates it');

  // A 0-count chip is disabled (can't select a filter guaranteed to be empty)
  const idleChip = await page.locator('.filter-chip', { hasText: 'Idea' }).first();
  const idleDisabled = await idleChip.evaluate(el => el.disabled);
  assert(idleDisabled === true, '"Idea" stage (0 papers in real data) renders as a disabled chip, not a clickable dead-end');

  // Open to New Members chip in the rail
  const openChip = await page.locator('.filter-chip', { hasText: 'Open to new members' }).first();
  await openChip.click();
  await page.waitForTimeout(150);
  resultText = await page.$eval('#result-count', el => el.textContent);
  console.log('After "Open to new members" rail chip:', resultText);
  const openBadges = await page.$$eval('.open-badge', els => els.length);
  const openCountFromResult = parseInt(resultText.match(/^(\d+) of/)[1], 10);
  assert(openBadges === openCountFromResult, 'Every card shown after the Open-to-new-members rail filter carries the badge, got ' + openBadges + ' badges for ' + openCountFromResult + ' cards');

  assert(errors.length === 0, 'No console errors during filter interactions, got: ' + JSON.stringify(errors));
  await page.close();

  // ================= Right rail: Upcoming deadlines widget navigates =================
  ({ page, errors } = await freshPage(browser, { width: 1680, height: 1000 }));

  const deadlineItem = await page.$('.rail-widget-item[data-focus-paper]');
  assert(deadlineItem !== null, 'Upcoming deadlines widget renders at least one clickable item');
  const targetPaperId = await deadlineItem.getAttribute('data-focus-paper');
  await deadlineItem.click();
  await page.waitForTimeout(400);
  const openCard = await page.$('.paper-card[data-paper-id="' + targetPaperId + '"] .detail-panel.open');
  assert(openCard !== null, 'Clicking an "Upcoming deadlines" widget item clears filters and opens that exact paper\'s detail panel');
  const searchCleared = await page.$eval('#search-input', el => el.value);
  assert(searchCleared === '', 'Search box is cleared by the widget jump');

  assert(errors.length === 0, 'No console errors using the right-rail widget, got: ' + JSON.stringify(errors));
  await page.close();

  // ================= Demo banner: slim, dismissible, reappears on reload =================
  ({ page, errors } = await freshPage(browser, { width: 1280, height: 900 }));

  const bannerVisibleBefore = await page.$eval('#demo-banner', el => getComputedStyle(el).display !== 'none');
  assert(bannerVisibleBefore, 'Demo banner is visible by default');
  await page.click('#dismiss-demo-btn');
  await page.waitForTimeout(100);
  const bannerVisibleAfterDismiss = await page.$eval('#demo-banner', el => getComputedStyle(el).display !== 'none');
  assert(!bannerVisibleAfterDismiss, 'Dismissing the demo banner hides it');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  const bannerVisibleAfterReload = await page.$eval('#demo-banner', el => getComputedStyle(el).display !== 'none');
  assert(!bannerVisibleAfterReload, 'Dismissal persists across a reload within the same session (sessionStorage)');
  const headerTop = await page.$eval('header.site', el => el.getBoundingClientRect().top);
  assert(headerTop < 30, 'With the banner dismissed, the header/logo sits right at the top of the page, got top=' + headerTop);

  assert(errors.length === 0, 'No console errors around the demo banner, got: ' + JSON.stringify(errors));
  await page.close();

  // ================= WhatsApp field + team members: create + edit + read view =================
  ({ page, errors } = await freshPage(browser, { width: 1280, height: 1000 }));

  await page.click('#new-project-btn');
  await page.waitForTimeout(150);
  await page.fill('#new-project-title', 'Layout Test WhatsApp Project');
  await page.fill('#new-project-name', 'Layout Tester');
  await page.fill('#new-project-whatsapp', 'https://wa.me/15550001111');
  await page.click('[data-add-team-member]');
  await page.waitForTimeout(100);
  const teamRows = await page.$$('#new-project-team .resource-edit-row');
  await teamRows[teamRows.length - 1].$eval('.tm-name', el => el.value = 'Test Teammate');
  await teamRows[teamRows.length - 1].$eval('.tm-linkedin', el => el.value = 'https://linkedin.com/in/fake-test-teammate');
  await page.check('#new-project-open');
  await page.click('#new-project-save');
  await page.waitForTimeout(300);

  await page.fill('#search-input', 'Layout Test WhatsApp Project');
  await page.waitForTimeout(200);
  await page.click('[data-open-detail]');
  await page.waitForTimeout(200);
  const detailText = await page.$eval('.detail-panel', el => el.textContent);
  assert(detailText.includes('Chat on WhatsApp'), 'Detail read view shows the WhatsApp contact link');
  assert(detailText.includes('Test Teammate'), 'Detail read view shows the team member name');
  const linkedinHref = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('.detail-panel a'));
    const l = links.find(a => a.href.includes('fake-test-teammate'));
    return l ? l.href : null;
  });
  assert(linkedinHref && linkedinHref.includes('linkedin.com'), 'Team member LinkedIn link is a real href, got: ' + linkedinHref);

  assert(errors.length === 0, 'No console errors creating a project with WhatsApp + team members, got: ' + JSON.stringify(errors));
  await page.close();

  // ================= discover.html: WhatsApp button + team chips render =================
  page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  const discoverErrors = [];
  page.on('console', m => { if (m.type() === 'error') discoverErrors.push(m.text()); });
  await page.goto(DISCOVER + '?data=data.sample.public.json', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const whatsappBtn = await page.$('.whatsapp-btn');
  assert(whatsappBtn !== null, 'At least one sample open project shows a WhatsApp button on discover.html');
  const whatsappHref = await whatsappBtn.getAttribute('href');
  assert(whatsappHref.startsWith('https://wa.me/'), 'WhatsApp button links to a real wa.me URL, got: ' + whatsappHref);

  const teamChips = await page.$$('.team-chip');
  assert(teamChips.length > 0, 'At least one sample open project shows team member chips on discover.html');
  const teamChipHref = await page.$eval('a.team-chip', el => el.getAttribute('href'));
  assert(teamChipHref && teamChipHref.includes('linkedin.com'), 'A team chip with a LinkedIn URL renders as a real link, got: ' + teamChipHref);

  await page.screenshot({ path: path.join(DIR, 'layout_discover_whatsapp_team.png'), fullPage: true });
  assert(discoverErrors.length === 0, 'No console errors on discover.html with whatsapp/team data, got: ' + JSON.stringify(discoverErrors));
  await page.close();

  // ================= Tablet (900px) and mobile (390px) full-page screenshots =================
  page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  await page.goto(INDEX, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const tabletScrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  const tabletClientW = await page.evaluate(() => document.documentElement.clientWidth);
  assert(tabletScrollW <= tabletClientW + 2, 'No horizontal overflow at 900px tablet width (scrollWidth=' + tabletScrollW + ' clientWidth=' + tabletClientW + ')');
  const filtersToggleVisible = await page.$eval('#filters-toggle', el => getComputedStyle(el).display !== 'none');
  assert(filtersToggleVisible, 'The Filters toggle button is visible at tablet width (left rail collapsed behind it)');
  await page.screenshot({ path: path.join(DIR, 'layout_tablet_900.png'), fullPage: true });
  await page.close();

  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const mobileErrors = [];
  page.on('console', m => { if (m.type() === 'error') mobileErrors.push(m.text()); });
  await page.goto(INDEX, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const mobileScrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  const mobileClientW = await page.evaluate(() => document.documentElement.clientWidth);
  assert(mobileScrollW <= mobileClientW + 2, 'No horizontal overflow at 390px mobile width (scrollWidth=' + mobileScrollW + ' clientWidth=' + mobileClientW + ')');
  await page.screenshot({ path: path.join(DIR, 'layout_mobile_390.png'), fullPage: true });
  assert(mobileErrors.length === 0, 'No console errors on mobile, got: ' + JSON.stringify(mobileErrors));
  await page.close();

  await browser.close();
  console.log('\nALL LAYOUT TESTS PASSED');
})().catch(err => { console.error(err); process.exit(1); });
