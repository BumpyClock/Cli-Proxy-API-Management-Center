import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = resolve(process.env.BROWSER_ARTIFACT_DIR ?? 'docs/screenshots/upstream-backports');
let vite;
let browser;
try {
  assert(
    process.env.PLAYWRIGHT_MODULE,
    'Set PLAYWRIGHT_MODULE to an installed playwright-core/index.mjs.'
  );
  const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
  const reservation = Bun.serve({ port: 0, fetch: () => new Response('reserved') });
  const port = reservation.port;
  reservation.stop(true);
  vite = Bun.spawn(
    [
      process.execPath,
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    { stdout: 'ignore', stderr: 'ignore' }
  );
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ??
      process.env.CHROME_EXECUTABLE ??
      (process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : undefined),
    headless: true,
  });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (true) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    assert(Date.now() < deadline, 'Timed out waiting for Vite');
    await Bun.sleep(50);
  }
  await mkdir(output, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1000, height: 700 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const input = page.locator('#fixture-model');
  const menu = page.getByRole('listbox');
  const settle = () =>
    page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished)
      )
    );
  await page.goto(`${origin}/tests/fixtures/autocompletePreview.html`);
  await input.focus();
  await menu.waitFor({ state: 'visible' });
  for (const open of [false, true]) {
    await input.locator('..').locator('input + div').click();
    await menu.waitFor({ state: open ? 'visible' : 'detached' });
    assert.equal(await input.evaluate((element) => element === document.activeElement), true);
  }
  const scrollWork = await page.evaluate(async () => {
    const frame = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await frame();
    const wrapper = document.getElementById('fixture-model').parentElement;
    const original = wrapper.getBoundingClientRect;
    let reads = 0;
    wrapper.getBoundingClientRect = function () {
      reads++;
      return original.call(this);
    };
    try {
      document.querySelector('[role="listbox"]').dispatchEvent(new Event('scroll'));
      await frame();
      const internal = reads;
      window.dispatchEvent(new Event('scroll'));
      await frame();
      return { internal, external: reads - internal };
    } finally {
      wrapper.getBoundingClientRect = original;
    }
  });
  assert.equal(scrollWork.internal, 0, 'Menu scrolling must not reposition its stationary anchor');
  assert(scrollWork.external > 0, 'Viewport scrolling must still reposition the menu');
  assert.deepEqual(
    await page.evaluate(() => {
      const menu = document.querySelector('[role="listbox"]');
      const bounds = menu.getBoundingClientRect();
      const clip = document.getElementById('clip').getBoundingClientRect();
      return {
        portalled: menu.parentElement === document.body,
        inViewport:
          bounds.top >= 0 &&
          bounds.bottom <= innerHeight &&
          bounds.left >= 0 &&
          bounds.right <= innerWidth,
        escapedClip: bounds.top < clip.top,
        describedBy: document.getElementById('fixture-model').getAttribute('aria-describedby'),
      };
    }),
    { portalled: true, inViewport: true, escapedClip: true, describedBy: 'fixture-help' }
  );
  await page.screenshot({ path: join(output, 'autocomplete-desktop.png') });
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('Enter');
  assert.equal(await page.locator('#selection').textContent(), 'Beta');
  await menu.waitFor({ state: 'detached' });
  await input.press('ArrowDown');
  await menu.waitFor({ state: 'visible' });
  assert.equal(
    await input.evaluate((element) => {
      const active = element.getAttribute('aria-activedescendant');
      return !active || !!document.getElementById(active);
    }),
    true,
    'Reopening must not reference an option from the unfiltered list'
  );
  await input.press('ArrowDown');
  assert.equal(
    await input.evaluate(
      (element) =>
        document.getElementById(element.getAttribute('aria-activedescendant'))?.textContent
    ),
    'Beta',
    'Keyboard navigation must reach the only remaining option'
  );
  await input.press('Escape');
  await menu.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 360, height: 480 });
  await input.press('ArrowDown');
  await menu.waitFor({ state: 'visible' });
  assert.equal(
    await menu.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.top >= 0 &&
        bounds.bottom <= innerHeight &&
        bounds.left >= 0 &&
        bounds.right <= innerWidth
      );
    }),
    true
  );
  await page.screenshot({ path: join(output, 'autocomplete-mobile.png') });
  await input.fill('');
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length === 3);
  assert.equal(await page.locator('#selection').textContent(), '');
  await page.getByRole('option', { name: 'Gamma', exact: true }).click();
  await menu.waitFor({ state: 'detached' });
  assert.equal(await input.inputValue(), 'Gamma');
  assert.equal(await page.locator('#selection').textContent(), 'Gamma');
  assert.equal(await input.evaluate((element) => element === document.activeElement), true);
  await input.press('ArrowDown');
  await menu.waitFor({ state: 'visible' });
  await input.press('Tab');
  await menu.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1000, height: 700 });
  const dialog = page.getByRole('dialog');
  for (const scenario of ['', '&no-options=1', '&no-match=1']) {
    await page.goto(`${origin}/tests/fixtures/autocompletePreview.html?sheet=1${scenario}`);
    await dialog.waitFor({ state: 'visible' });
    await settle();
    await input.focus();
    if (!scenario) {
      await menu.waitFor({ state: 'visible' });
      await page.screenshot({ path: join(output, 'autocomplete-sheet.png') });
      await input.press('Escape');
      await menu.waitFor({ state: 'detached' });
      await settle();
      assert.equal(await dialog.isVisible(), true, 'First Escape must only close the menu');
    } else {
      assert.equal(await menu.count(), 0);
    }
    await input.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        sheet: 'passed',
        emptyMenuEscape: 'passed',
        desktop: 'passed',
        mobile: 'passed',
        keyboard: 'passed',
        pointer: 'passed',
        screenshots: output,
      },
      null,
      2
    )
  );
} finally {
  await browser?.close().catch((error) => {
    console.error('Browser cleanup failed:', error);
    process.exitCode = 1;
  });
  vite?.kill();
  await vite?.exited;
}
