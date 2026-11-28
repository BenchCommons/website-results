import { expect, test } from '@playwright/test';
import { open } from './helpers.js';

const lang = (page, name) => page.getByRole('group', { name: 'Language' }).getByRole('checkbox', { name, exact: true });

const HASH = '#section=results&round=2026-10-11&suite=G&cell=nf10000-cs50&view=table&lang=Go,Rust';

async function assertState(page) {
  await expect(page.getByRole('tab', { name: /^G 10,000/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '50 KB posts' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Data table' })).toHaveAttribute('aria-pressed', 'true');
  await expect(lang(page, 'Go')).toBeChecked();
  await expect(lang(page, 'Ruby')).not.toBeChecked();
  const langs = await page.locator('main table tbody tr td:nth-child(3)').allInnerTexts();
  expect(langs.length).toBeGreaterThan(0);
  expect(new Set(langs)).toEqual(new Set(langs.filter((l) => l === 'Go' || l === 'Rust')));
}

test('a link restores the same view, also after a reload', async ({ page }) => {
  await open(page, HASH);
  await assertState(page);
  await page.reload();
  await assertState(page);
});

test('changing a filter updates the link', async ({ page }) => {
  await open(page, HASH);
  await lang(page, 'Python').check();
  await expect(page).toHaveURL(/lang=Go,Python,Rust/);
});

test('an old link to a missing round falls back instead of showing a blank page', async ({ page }) => {
  await open(page, '#round=1999-01-01&suite=XL&cell=nope');
  await expect(page.locator('main h1')).toContainText('Results, round');
  expect(await page.locator('.chart li').count()).toBeGreaterThan(0);
});

test('a late answer for a round that was switched away from does not replace the selected round', async ({ page }) => {
  // 2026-10-06 answers only after the user has moved on to 2026-10-05.
  let release;
  const gate = new Promise((r) => (release = r));
  await page.route('**/data/rounds/2026-10-06.json', async (route) => {
    await gate;
    await route.continue();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/#section=environment&round=2026-10-06');
  await expect(page.getByText('Loading round 2026-10-06')).toBeVisible();
  await page.evaluate(() => { location.hash = '#section=environment&round=2026-10-05'; });
  await expect(page.locator('main h1')).toContainText('2026-10-05');
  // Record every text the page shows from now on.
  await page.evaluate(() => {
    window.__seen = [];
    new MutationObserver(() => window.__seen.push(document.querySelector('main')?.innerText ?? '')).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  release();
  await page.waitForResponse('**/data/rounds/2026-10-06.json');
  await page.waitForTimeout(300);
  await expect(page.locator('main h1')).toContainText('2026-10-05');
  await expect(page).toHaveURL(/round=2026-10-05/);
  const seen = await page.evaluate(() => window.__seen);
  expect(seen.filter((t) => t.includes('2026-10-06') || t.includes('Loading round'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('the error of a round that failed to load goes away when another round is selected', async ({ page }) => {
  await page.route('**/data/rounds/2026-10-06.json', (route) => route.fulfill({ status: 500, body: 'boom' }));
  await page.goto('/#section=environment&round=2026-10-06');
  await expect(page.getByRole('alert')).toContainText('HTTP 500');
  await page.evaluate(() => { location.hash = '#section=environment&round=2026-10-05'; });
  await expect(page.locator('main h1')).toContainText('2026-10-05');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

// Round ids come from the published index, so the tests do not depend on which rounds the data submodules pin.
async function roundIds(request) {
  const index = await (await request.get('/data/rounds.json')).json();
  expect(index.rounds.length).toBeGreaterThan(1);
  return index.rounds.map((r) => r.id);
}

test('after a round fails to load the navigation stays and another round can be selected', async ({ page, request }) => {
  const [bad, good] = await roundIds(request);
  await page.route(`**/data/rounds/${bad}.json`, (route) => route.fulfill({ status: 500, body: 'boom' }));
  await page.goto(`/#section=results&round=${good}`);
  await expect(page.locator('main h1')).toContainText(good);
  await page.evaluate((id) => { location.hash = `#section=results&round=${id}`; }, bad);
  await expect(page.getByRole('alert')).toContainText('HTTP 500');
  await expect(page.getByRole('alert')).toContainText(bad);
  // The loaded round is never shown as the selected one.
  await expect(page.locator('main h1')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await page.getByLabel('Round').selectOption(good);
  await expect(page.locator('main h1')).toContainText(good);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Retry fetches the failed round again and recovers the results', async ({ page, request }) => {
  const [bad] = await roundIds(request);
  let calls = 0;
  await page.route(`**/data/rounds/${bad}.json`, (route) => (++calls === 1 ? route.fulfill({ status: 500, body: 'boom' }) : route.continue()));
  await page.goto(`/#section=results&round=${bad}`);
  await expect(page.getByRole('alert')).toContainText('HTTP 500');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('main h1')).toContainText(bad);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(calls).toBe(2);
});

test('Retry reloads the round index after it failed', async ({ page }) => {
  let calls = 0;
  await page.route('**/data/rounds.json', (route) => (++calls === 1 ? route.fulfill({ status: 500, body: 'boom' }) : route.continue()));
  await page.goto('/#section=results');
  await expect(page.getByRole('alert')).toContainText('HTTP 500');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('main h1')).toContainText('Results, round');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('going back to a round that failed shows the loading state, not the old error, until the new attempt ends', async ({ page, request }) => {
  const [bad, good] = await roundIds(request);
  let calls = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  await page.route(`**/data/rounds/${bad}.json`, async (route) => {
    if (++calls === 1) return route.fulfill({ status: 500, body: 'boom' });
    await gate;
    return route.continue();
  });
  await page.goto(`/#section=results&round=${bad}`);
  await expect(page.getByRole('alert')).toContainText('HTTP 500');
  await page.getByLabel('Round').selectOption(good);
  await expect(page.locator('main h1')).toContainText(good);
  await page.evaluate((id) => { location.hash = `#section=results&round=${id}`; }, bad);
  await expect(page.getByText(`Loading round ${bad}`)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  release();
  await expect(page.locator('main h1')).toContainText(bad);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
