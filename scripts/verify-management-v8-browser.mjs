import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertFixtureConfig, fixtureConnection } from './lib/management-v8-fixture.mjs';

let browser;
let page;
let restore;
let releaseStaleYaml = () => {};
const passed = (name) => console.log(`PASS ${name}`);
try {
  const { base, key } = fixtureConnection();
  const origin = process.env.ORIGIN ?? 'http://127.0.0.1:5179';
  assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
  const request = async (path, options = {}) => {
    const response = await fetch(`${base}/v8/management${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    assert(response.ok, `Fixture ${path} returned HTTP ${response.status}.`);
    return response;
  };
  const replace = async (path, value) => {
    const snapshot = await request('/config');
    const etag = snapshot.headers.get('etag');
    assert(etag, 'The native fixture must expose ETag.');
    await request(path, {
      method: 'PUT',
      headers: { 'If-Match': etag },
      body: JSON.stringify(value),
    });
  };
  const initial = await (await request('/config')).json();
  assertFixtureConfig(initial);
  assert.equal((await (await request('/credentials')).json()).files.length, 0);
  assert(
    process.env.PLAYWRIGHT_MODULE,
    'Set PLAYWRIGHT_MODULE to an installed playwright-core/index.mjs.'
  );
  const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_EXECUTABLE ??
      (process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : undefined),
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
    reducedMotion: 'reduce',
  });
  const staleYamlGate = new Promise((resolve) => {
    releaseStaleYaml = resolve;
  });
  let deliverStaleYaml;
  const staleYamlDelivered = new Promise((resolve) => {
    deliverStaleYaml = resolve;
  });
  let yamlReads = 0;
  await context.route('**/*', async (route) => {
    try {
      const url = new URL(route.request().url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
      if (
        url.pathname.endsWith('/v8/management/config.yaml') &&
        route.request().method() === 'GET' &&
        ++yamlReads === 1
      ) {
        const response = await route.fetch();
        await staleYamlGate;
        await route.fulfill({ response });
        deliverStaleYaml();
        return;
      }
      return route.continue();
    } catch {
      return route.abort();
    }
  });
  page = await context.newPage();
  const errors = [];
  const forbidden = [];
  const yamlWrites = [];
  const dismissNotices = async () => {
    const buttons = page
      .locator('div:has(> [role="alert"]), div:has(> [role="status"])')
      .getByRole('button', { name: 'Close', exact: true });
    for (const button of await buttons.elementHandles()) {
      try {
        if (await button.isEnabled()) await button.click();
        await button.waitForElementState('hidden');
      } catch (error) {
        if (await button.isVisible()) throw error;
      }
    }
  };
  const settlePhoneNavigation = async () => {
    await page.waitForFunction(() => {
      const sidebar = document.querySelector('#app-sidebar');
      return sidebar?.hasAttribute('inert') || sidebar?.getAttribute('role') === 'dialog';
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.querySelector('#app-sidebar').getBoundingClientRect().right <= 1
    );
  };
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith('/config.yaml'))
      yamlWrites.push(Boolean(request.headers()['if-match']));
    if (/\/v0\/management|\/observability\/usage\/queue/.test(request.url()))
      forbidden.push('forbidden management request');
  });
  await page.goto(origin);
  await page.bringToFront();
  await page.getByText('Custom connection URL', { exact: true }).click();
  assert(
    await page.getByRole('checkbox', { name: 'Custom connection URL', exact: true }).isChecked()
  );
  await page.getByRole('textbox', { name: 'Custom connection URL', exact: true }).fill(base);
  await page.getByLabel('Management Key', { exact: true }).fill('cpamc-intentionally-wrong');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.locator('#login-error').waitFor();
  assert.match(await page.locator('#login-error').innerText(), /HTTP 401.*Authentication failed/);
  passed('wrong management key produces a visible localized 401');
  await page.getByLabel('Management Key', { exact: true }).fill(key);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.locator('main').waitFor();
  await dismissNotices();
  passed('native v8 login succeeds after a rejected key');

  const outDir = resolve(process.env.CPAMC_SCREENSHOTS ?? 'docs/screenshots/management-v8');
  await mkdir(outDir, { recursive: true });
  await page.getByRole('link', { name: 'Usage Statistics', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Usage statistics unavailable', exact: true }).waitFor();
  await page.screenshot({ path: resolve(outDir, 'usage-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await settlePhoneNavigation();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: resolve(outDir, 'usage-mobile.png'), fullPage: true });
  passed('unsupported native usage is explicit on desktop and mobile, without queue reads');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'OAuth Login', exact: true }).first().click();
  await page.getByRole('button', { name: 'Log in with Devin', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Log in with Qoder', exact: true }).count(),
    0
  );
  assert.equal(
    await page.getByRole('button', { name: 'Log in with Kimi China', exact: true }).count(),
    1
  );
  assert.equal(
    await page.getByRole('button', { name: 'Log in with Kimi International', exact: true }).count(),
    1
  );
  passed('native OAuth choices retain regional logins without fabricating Qoder support');

  const before = initial['api-keys']?.meta ?? [];
  let configEdited = false;
  restore = async () => {
    await replace('/config/api-keys/meta', before);
    if (configEdited)
      await replace(
        '/config/observability/logs/debug',
        initial.observability?.logs?.debug ?? false
      );
  };
  await replace('/config/api-keys/meta', [
    ...before,
    {
      name: 'native-browser-fixture',
      'base-url': 'https://provider.invalid/v1',
      keys: [
        {
          'api-key': 'cpamc-browser-upstream',
          'proxy-url': 'http://127.0.0.1:1',
          models: [
            { name: 'native-model-a', alias: 'alias-a', 'display-name': 'Retain A' },
            { name: 'native-model-b', alias: 'alias-b', 'display-name': 'Retain B' },
          ],
        },
      ],
    },
  ]);
  const openEditor = async () => {
    await page.getByRole('link', { name: 'AI Providers', exact: true }).first().click();
    await page
      .locator('main table tbody tr')
      .first()
      .getByRole('button', { name: /Actions/ })
      .click();
    await page.getByRole('menuitem', { name: /Edit/ }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByText('Custom models', { exact: true }).click();
    await sheet.getByPlaceholder('model-name').first().waitFor();
    return sheet;
  };
  let sheet = await openEditor();
  await sheet.getByPlaceholder('model-name').first().fill('renamed-a');
  await sheet.getByPlaceholder('alias (optional)').first().fill('renamed-alias-a');
  await page.screenshot({ path: resolve(outDir, 'provider-sheet-desktop.png'), fullPage: true });
  await sheet.getByRole('button', { name: /^Save/ }).click();
  await sheet.waitFor({ state: 'detached' });
  const group = async () =>
    (await (await request('/config')).json())['api-keys'].meta.find(
      (entry) => entry.name === 'native-browser-fixture'
    );
  let current = await group();
  assert.equal(current.keys[0].models[0].name, 'renamed-a');
  assert.equal(current.keys[0].models[0]['display-name'], 'Retain A');
  passed('actual provider form renames retain hidden native model metadata');

  sheet = await openEditor();
  await sheet.getByPlaceholder('alias (optional)').first().focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await sheet.getByRole('button', { name: 'Add model', exact: true }).click();
  await sheet.getByPlaceholder('model-name').nth(1).fill('renamed-a');
  await sheet.getByPlaceholder('alias (optional)').nth(1).fill('renamed-alias-a');
  await sheet.getByRole('button', { name: /^Save/ }).click();
  await sheet.waitFor({ state: 'detached' });
  current = await group();
  assert.equal(current.keys[0].models[0]['display-name'], 'Retain B');
  assert.equal(current.keys[0].models[1].name, 'renamed-a');
  assert(!Object.prototype.hasOwnProperty.call(current.keys[0].models[1], 'display-name'));
  passed('removing and replacing an identical-looking model cannot transfer old metadata');

  await page.getByRole('link', { name: 'Config Panel', exact: true }).first().click();
  const debug = page.getByRole('switch', { name: /debug/i }).and(page.locator(':enabled'));
  await debug.waitFor({ state: 'attached' });
  assert.equal(await debug.isChecked(), false);
  await debug.focus();
  await page.keyboard.press('Space');
  assert.equal(await debug.isChecked(), true);
  releaseStaleYaml();
  await staleYamlDelivered;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  assert.equal(
    await debug.isChecked(),
    true,
    'A superseded initial YAML response cannot reset a user edit.'
  );
  passed('a delayed native YAML load cannot discard edits made after the current load');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  const diff = page.getByRole('dialog');
  await diff.waitFor();
  configEdited = true;
  await diff.getByRole('button', { name: 'Confirm Save', exact: true }).click();
  await diff.waitFor({ state: 'detached' });
  assert.equal(
    (await (await request('/config')).json()).observability.logs.debug,
    true,
    'Native YAML save must persist the debug flag.'
  );
  await page
    .getByRole('button', { name: 'Save changes', exact: true })
    .waitFor({ state: 'detached' });
  assert.equal(await debug.isChecked(), true);
  assert.deepEqual(yamlWrites, [true]);
  await page.getByRole('status').filter({ hasText: 'Configuration saved successfully' }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  await dismissNotices();
  await page.screenshot({ path: resolve(outDir, 'config-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await settlePhoneNavigation();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(
    await page
      .locator('main select option')
      .evaluateAll((options) => options.map((option) => option.value)),
    ['common', 'connectivity', 'network', 'logging', 'streaming', 'advanced', 'payload']
  );
  await page.screenshot({ path: resolve(outDir, 'config-mobile.png'), fullPage: true });
  passed(
    'native visual YAML preview/save sends If-Match, retains the saved value and keeps mobile sections'
  );
  assert.deepEqual(forbidden, []);
  assert.deepEqual(errors, []);
} catch (error) {
  if (page && !page.isClosed()) {
    console.error(
      await page.evaluate(() => ({
        route: location.hash.split('?')[0],
        headings: [...document.querySelectorAll('h1,h2')].map((node) => node.textContent),
        configStatus: document.querySelector('main header')?.textContent,
        invalidControls: [...document.querySelectorAll('main [aria-invalid="true"]')].map(
          (node) => node.id
        ),
        saveState: [...document.querySelectorAll('button')]
          .filter((node) => node.textContent?.trim() === 'Save changes')
          .map((node) => ({ disabled: node.disabled })),
      }))
    );
  }
  console.error(error instanceof Error ? error.message : 'Native v8 browser verification failed.');
  process.exitCode = 1;
} finally {
  releaseStaleYaml();
  await browser?.close();
  if (restore) {
    try {
      await restore();
    } catch {
      console.error('Native fixture cleanup failed. Destroy the fixture sandbox.');
      process.exitCode = 1;
    }
  }
}
