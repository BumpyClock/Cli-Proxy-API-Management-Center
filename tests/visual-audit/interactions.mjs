// Native-input checks for the toolbars, menus, selectors and charts changed in the council
// fix passes. Same local fixtures as census.mjs; never reaches a real backend. Exits non-zero
// on any failure. Run manually (needs a browser and the dev server):
//   PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/visual-audit/interactions.mjs
import { pathToFileURL } from 'node:url';
import { installFixtures, login, gotoRoute } from './fixtures.mjs';

const playwrightPath = process.env.PLAYWRIGHT_MODULE;
if (!playwrightPath) throw new Error('Set PLAYWRIGHT_MODULE to playwright-core/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightPath));
const origin = process.env.ORIGIN ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE,
  headless: true,
});

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const desktop = {
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
  locale: 'en-US',
};
const phone = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  reducedMotion: 'reduce',
  locale: 'en-US',
};

async function open(options) {
  const context = await browser.newContext(options);
  await installFixtures(context, origin);
  const page = await context.newPage();
  const writes = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/v0/management')) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  page.on('pageerror', (error) => check('no page error', false, error.message));
  await login(page, origin);
  return { context, page, writes };
}
const focusedIs = (page, locator) =>
  locator.evaluate((element) => element === document.activeElement).catch(() => false);

// Logs: Options disclosure keyboard behaviour and the guarded Clear logs action.
{
  const { context, page, writes } = await open(desktop);
  await gotoRoute(page, origin, '/logs');
  const trigger = page.getByRole('button', { name: /^Options/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  check('logs: Enter opens Options', (await trigger.getAttribute('aria-expanded')) === 'true');
  await page.keyboard.press('Escape');
  check('logs: Escape closes Options', (await trigger.getAttribute('aria-expanded')) === 'false');
  check('logs: Escape restores focus to Options', await focusedIs(page, trigger));
  await trigger.click();
  await page.getByRole('button', { name: 'Clear logs' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'detached' });
  check('logs: cancelled Clear logs sends no write', writes.length === 0, writes.join(', '));
  await context.close();
}

// Logs 390: search has its own row, and the Options overlay is on screen and not clipped.
{
  const { context, page } = await open(phone);
  await gotoRoute(page, origin, '/logs');
  const search = await page.getByRole('textbox', { name: /search/i }).boundingBox();
  check('logs 390: search spans the row', (search?.width ?? 0) >= 340, String(search?.width));
  await page.getByRole('button', { name: /^Options/ }).tap();
  const clear = page.getByRole('button', { name: 'Clear logs' });
  const hit = await clear.evaluate((button) => {
    const r = button.getBoundingClientRect();
    const inside = r.left >= 0 && r.right <= innerWidth;
    return (
      inside && button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    );
  });
  check('logs 390: Options overlay is inside the viewport and hit-testable', hit);
  await context.close();
}

// Auth Files: labelled View options, status segmented filter, phone provider select.
{
  const { context, page } = await open(desktop);
  await gotoRoute(page, origin, '/auth-files');
  const trigger = page.getByRole('button', { name: /^View options/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  check(
    'auth-files: Enter opens View options',
    (await trigger.getAttribute('aria-expanded')) === 'true'
  );
  await page.keyboard.press('Escape');
  check('auth-files: Escape restores focus', await focusedIs(page, trigger));
  const status = page.getByRole('group', { name: 'Status Filter' });
  await status.getByRole('button', { name: 'Enabled' }).click();
  check(
    'auth-files: status segment reports pressed',
    (await status.getByRole('button', { name: 'Enabled' }).getAttribute('aria-pressed')) === 'true'
  );
  await context.close();
}
{
  const { context, page } = await open(phone);
  await gotoRoute(page, origin, '/auth-files');
  const rows = () => page.locator('main table tbody tr').count();
  const before = await rows();
  await page.getByLabel('Provider', { exact: true }).selectOption('claude');
  await page.waitForTimeout(200);
  const after = await rows();
  check(
    'auth-files 390: provider select filters rows',
    after > 0 && after < before,
    `${before} -> ${after}`
  );
  await context.close();
}

// Providers: labelled row Actions menu with arrow keys and focus restore; delete stays guarded.
{
  const { context, page, writes } = await open(desktop);
  await gotoRoute(page, origin, '/ai-providers');
  const trigger = page
    .locator('main table tbody tr')
    .first()
    .getByRole('button', { name: /Actions/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  check('providers: Enter opens Actions menu', await menu.isVisible());
  await page.keyboard.press('ArrowDown');
  const focusedItem = await page.evaluate(() => document.activeElement?.getAttribute('role'));
  check(
    'providers: ArrowDown moves to a menu item',
    focusedItem === 'menuitem',
    String(focusedItem)
  );
  await page.keyboard.press('Escape');
  check(
    'providers: Escape closes and restores focus',
    (await menu.count()) === 0 && (await focusedIs(page, trigger))
  );
  await trigger.click();
  await page.getByRole('menuitem', { name: /Delete/ }).click();
  const confirm = page.locator('[role="dialog"], [role="alertdialog"]').first();
  await confirm.waitFor();
  await confirm.getByRole('button', { name: /cancel/i }).click();
  await page.waitForTimeout(300);
  check('providers: cancelled delete sends no write', writes.length === 0, writes.join(', '));
  await context.close();
}

// OAuth Login search; editor deep link survives reload; phones use the top bar Back link.
{
  const { context, page } = await open(desktop);
  await gotoRoute(page, origin, '/oauth');
  const search = page.getByRole('searchbox').or(page.getByRole('textbox')).first();
  await search.click();
  await page.keyboard.type('kimi');
  await page.waitForTimeout(200);
  const status = await page.getByRole('status').filter({ hasText: /of/ }).first().textContent();
  check('oauth: typing filters providers', /^2 of /.test(status?.trim() ?? ''), status ?? '');
  await page.keyboard.press('Escape');
  check('oauth: Escape clears the search', (await search.inputValue()) === '');
  for (const route of [
    '/auth-files/oauth-excluded?provider=claude',
    '/auth-files/oauth-model-alias?provider=codex',
  ]) {
    await gotoRoute(page, origin, route);
    check(
      `oauth editor: ${route.split('?')[0]} keeps ?provider after reload`,
      page.url().includes('?provider=')
    );
  }
  await context.close();
}
{
  const { context, page } = await open(phone);
  await gotoRoute(page, origin, '/auth-files/oauth-excluded');
  const back = page.getByRole('link', { name: /Back to Auth Files/ });
  check('oauth editor 390: top bar Back link visible', await back.isVisible());
  check(
    'oauth editor 390: page Back button not duplicated',
    !(await page.locator('main').getByRole('button', { name: 'Back', exact: true }).isVisible())
  );
  await context.close();
}

// Quota: short x labels, one per day band or whole hour, never overlap and stay near the plot;
// the exact range is a caption under the axis; the account list precedes the chart on phones.
for (const options of [desktop, phone]) {
  const { context, page } = await open(options);
  await gotoRoute(page, origin, '/quota');
  const width = options.viewport.width;
  for (const window of ['Weekly', '5-hour']) {
    await page.getByRole('button', { name: window, exact: true }).click();
    await page.waitForTimeout(300);
    const geometry = await page.evaluate(() => {
      const list = document.querySelector('main ul[aria-label="Remaining by account"]');
      const figure = list
        ? [...document.querySelectorAll('main figure')].find((f) =>
            f.querySelector('.recharts-xAxis')
          )
        : null;
      const grid = figure
        ?.querySelector('.recharts-cartesian-grid-horizontal line')
        ?.getBoundingClientRect();
      const ticks = [...(figure?.querySelectorAll('.recharts-xAxis-tick-labels text') ?? [])].map(
        (text) => {
          const box = text.getBoundingClientRect();
          return { text: text.textContent, left: box.left, right: box.right };
        }
      );
      const caption = [...(figure?.querySelectorAll('p') ?? [])].find((p) =>
        p.textContent.includes(' – ')
      );
      return grid
        ? {
            ticks,
            plotLeft: grid.left,
            plotRight: grid.right,
            caption: caption?.textContent ?? null,
            listTop: Math.round(list.getBoundingClientRect().top),
            chartTop: Math.round(figure.getBoundingClientRect().top),
          }
        : null;
    });
    const ticks = geometry?.ticks ?? [];
    const clear = ticks.slice(1).every((tick, index) => tick.left >= ticks[index].right + 4);
    const inside =
      ticks.length > 0 &&
      ticks[0].left >= geometry.plotLeft - 20 &&
      ticks.at(-1).right <= geometry.plotRight + 14;
    const short = ticks.every((tick) => !/\d{1,2}:\d{2}.*,|,.*\d{1,2}:\d{2}/.test(tick.text));
    check(
      `quota ${width} ${window}: short axis labels clear each other inside the plot`,
      ticks.length >= 2 && clear && inside && short,
      ticks.map((tick) => tick.text).join(' | ')
    );
    check(
      `quota ${width} ${window}: exact range is a caption under the axis`,
      Boolean(geometry?.caption),
      geometry?.caption ?? 'none'
    );
    if (width === 390 && window === 'Weekly') {
      check('quota 390: account list before chart', geometry?.listTop < geometry?.chartTop);
    }
  }
  await context.close();
}

// Quota: the account list drives chart isolation by keyboard; "Show all series" restores it.
{
  const { context, page } = await open(desktop);
  await gotoRoute(page, origin, '/quota');
  const list = page.locator('main ul[aria-label="Remaining by account"]');
  const toggles = list.locator('button[aria-pressed]');
  const lines = () => page.locator('main figure path.recharts-line-curve').count();
  const before = await lines();
  await toggles.first().focus();
  await page.keyboard.press('Enter');
  const pressed = await toggles.evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-pressed'))
  );
  check(
    'quota: Enter on a row shows only that account',
    pressed[0] === 'true' && pressed.slice(1).every((value) => value === 'false'),
    pressed.join(',')
  );
  check(
    'quota: isolated chart still draws a line',
    (await lines()) >= 1,
    `${before} -> ${await lines()}`
  );
  const showAll = page.getByRole('button', { name: 'Show all series' });
  await showAll.focus();
  await page.keyboard.press('Enter');
  const restored = await toggles.evaluateAll((els) =>
    els.every((el) => el.getAttribute('aria-pressed') === 'true')
  );
  check('quota: Show all series restores every account', restored);
  const filters = page.locator('main details', { hasText: 'Filter accounts' }).first();
  await filters.locator('summary').focus();
  await page.keyboard.press('Enter');
  check('quota: Enter opens Filter accounts', await filters.evaluate((d) => d.open));
  await context.close();
}

// Phone header: one Utilities menu; keyboard reaches Theme, selects Dark, returns focus.
{
  const { context, page } = await open(phone);
  await gotoRoute(page, origin, '/');
  const trigger = page.locator('header [aria-haspopup="menu"]').filter({ hasText: 'Utilities' });
  check('header 390: Utilities trigger has a visible name', await trigger.isVisible());
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.locator('header [role="menu"]');
  check('header 390: Enter opens the menu', await menu.isVisible());
  const items = await menu.locator('[role^="menuitem"]').allInnerTexts();
  check(
    'header 390: menu names refresh, languages, themes and sign out',
    ['Refresh config & page', 'English', 'Dark', 'Sign out'].every((name) =>
      items.some((item) => item.includes(name))
    ),
    items.join(' | ')
  );
  for (let i = 0; i < 12; i += 1) {
    const label = await page.evaluate(() => document.activeElement?.textContent ?? '');
    if (label.includes('Dark')) break;
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('header 390: selecting Dark switches the theme', theme === 'dark', String(theme));
  check('header 390: focus returns to Utilities', await focusedIs(page, trigger));
  await trigger.click();
  await page.keyboard.press('Escape');
  check('header 390: Escape closes the menu', !(await menu.isVisible()));
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall interaction checks passed');
if (failures) process.exit(1);
