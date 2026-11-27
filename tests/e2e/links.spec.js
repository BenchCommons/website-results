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
