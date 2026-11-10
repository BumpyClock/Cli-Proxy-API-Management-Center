import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'cpamc-browser-'));
const output = resolve(process.env.BROWSER_ARTIFACT_DIR ?? 'docs/screenshots/upstream-backports');
const chrome =
  process.env.CHROME_PATH ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'chromium');
let vite;
let browser;
let socket;
let failureDetails;
async function waitFor(read, description) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch {}
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
try {
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
  browser = Bun.spawn(
    [
      chrome,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdout: 'ignore', stderr: 'ignore' }
  );
  await mkdir(output, { recursive: true });
  const debugPort = await waitFor(
    async () =>
      Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]),
    'Chrome'
  );
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}`)).ok, 'Vite');
  const target = await (
    await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') console.error(JSON.stringify(message.params));
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10_000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const key = async (name, code) => {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: name,
      code: name,
      windowsVirtualKeyCode: code,
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: name,
      code: name,
      windowsVirtualKeyCode: code,
    });
  };
  failureDetails = async () =>
    console.error(
      await evaluate(
        `JSON.stringify({ body: document.body.innerText, input: document.getElementById('fixture-model')?.outerHTML, focused: document.activeElement?.outerHTML })`
      )
    );
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1000,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', {
    url: `http://127.0.0.1:${port}/tests/fixtures/autocompletePreview.html`,
  });
  await waitFor(() => evaluate(`!!document.getElementById('fixture-model')`), 'fixture input');
  // A background CDP target can change activeElement without dispatching React focus events.
  await send('Page.bringToFront');
  assert.equal(await evaluate('document.hasFocus()'), true);
  await evaluate(`document.getElementById('fixture-model').focus()`);
  await waitFor(() => evaluate(`!!document.querySelector('[role="listbox"]')`), 'dropdown');
  const scrollWork = await evaluate(`(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const wrapper = document.getElementById('fixture-model').parentElement;
    const original = wrapper.getBoundingClientRect;
    let reads = 0;
    wrapper.getBoundingClientRect = function () { reads++; return original.call(this); };
    try {
      document.querySelector('[role="listbox"]').dispatchEvent(new Event('scroll'));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const internal = reads;
      window.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { internal, external: reads - internal };
    } finally {
      wrapper.getBoundingClientRect = original;
    }
  })()`);
  assert.equal(scrollWork.internal, 0, 'Menu scrolling must not reposition its stationary anchor');
  assert(scrollWork.external > 0, 'Viewport scrolling must still reposition the menu');
  const placement = await evaluate(`(() => {
    const menu = document.querySelector('[role="listbox"]');
    const bounds = menu.getBoundingClientRect();
    const clip = document.getElementById('clip').getBoundingClientRect();
    return { portalled: menu.parentElement === document.body,
      inViewport: bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth,
      escapedClip: bounds.top < clip.top, describedBy: document.getElementById('fixture-model').getAttribute('aria-describedby') };
  })()`);
  assert.deepEqual(placement, {
    portalled: true,
    inViewport: true,
    escapedClip: true,
    describedBy: 'fixture-help',
  });
  const desktop = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(output, 'autocomplete-desktop.png'), Buffer.from(desktop.data, 'base64'));
  await key('ArrowDown', 40);
  await key('ArrowDown', 40);
  await key('Enter', 13);
  await waitFor(
    () => evaluate(`document.getElementById('selection').textContent === 'Beta'`),
    'keyboard selection'
  );
  assert.equal(await evaluate(`document.querySelector('[role="listbox"]') === null`), true);
  await key('ArrowDown', 40);
  await waitFor(() => evaluate(`!!document.querySelector('[role="listbox"]')`), 'reopened menu');
  await key('Escape', 27);
  await waitFor(() => evaluate(`!document.querySelector('[role="listbox"]')`), 'Escape dismissal');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 360,
    height: 480,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await key('ArrowDown', 40);
  await waitFor(() => evaluate(`!!document.querySelector('[role="listbox"]')`), 'mobile dropdown');
  assert.equal(
    await evaluate(
      `(() => { const r = document.querySelector('[role="listbox"]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; })()`
    ),
    true
  );
  const mobile = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(output, 'autocomplete-mobile.png'), Buffer.from(mobile.data, 'base64'));
  await evaluate(`document.getElementById('fixture-model').select()`);
  await key('Backspace', 8);
  await waitFor(
    () =>
      evaluate(
        `document.getElementById('fixture-model').value === '' && document.querySelectorAll('[role="option"]').length === 3`
      ),
    'unfiltered pointer options'
  );
  assert.equal(await evaluate(`document.getElementById('selection').textContent`), '');
  const point = await evaluate(
    `(() => { const option = [...document.querySelectorAll('[role="option"]')].find(node => node.textContent === 'Gamma'); const r = option.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    ...point,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    ...point,
  });
  await waitFor(() => evaluate(`!document.querySelector('[role="listbox"]')`), 'pointer selection');
  assert.equal(await evaluate(`document.getElementById('fixture-model').value`), 'Gamma');
  assert.equal(await evaluate(`document.getElementById('selection').textContent`), 'Gamma');
  assert.equal(await evaluate(`document.activeElement.id`), 'fixture-model');
  await key('ArrowDown', 40);
  await waitFor(() => evaluate(`!!document.querySelector('[role="listbox"]')`), 'menu before Tab');
  await key('Tab', 9);
  await waitFor(() => evaluate(`!document.querySelector('[role="listbox"]')`), 'Tab dismissal');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1000,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', {
    url: `http://127.0.0.1:${port}/tests/fixtures/autocompletePreview.html?sheet=1`,
  });
  await waitFor(
    () =>
      evaluate(
        `!!document.querySelector('[role="dialog"]') && !!document.getElementById('fixture-model')`
      ),
    'provider sheet fixture'
  );
  await evaluate(
    `Promise.all(document.getAnimations().filter((animation) => animation.effect.getTiming().iterations !== Infinity).map((animation) => animation.finished))`
  );
  await send('Page.bringToFront');
  await evaluate(`document.getElementById('fixture-model').focus()`);
  await waitFor(() => evaluate(`!!document.querySelector('[role="listbox"]')`), 'sheet dropdown');
  const sheet = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(output, 'autocomplete-sheet.png'), Buffer.from(sheet.data, 'base64'));
  await key('Escape', 27);
  await waitFor(
    () => evaluate(`!document.querySelector('[role="listbox"]')`),
    'sheet menu dismissal'
  );
  await Bun.sleep(300);
  assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`), true);
  await key('Escape', 27);
  await waitFor(() => evaluate(`!document.querySelector('[role="dialog"]')`), 'sheet dismissal');
  for (const scenario of ['no-options', 'no-match']) {
    await send('Page.navigate', {
      url: `http://127.0.0.1:${port}/tests/fixtures/autocompletePreview.html?sheet=1&${scenario}=1`,
    });
    await waitFor(
      () =>
        evaluate(
          `!!document.querySelector('[role="dialog"]') && !!document.getElementById('fixture-model')`
        ),
      scenario
    );
    await evaluate(
      `Promise.all(document.getAnimations().filter((animation) => animation.effect.getTiming().iterations !== Infinity).map((animation) => animation.finished))`
    );
    await send('Page.bringToFront');
    await evaluate(`document.getElementById('fixture-model').focus()`);
    assert.equal(await evaluate(`!!document.querySelector('[role="listbox"]')`), false);
    await key('Escape', 27);
    await waitFor(
      () => evaluate(`!document.querySelector('[role="dialog"]')`),
      `${scenario} Escape`
    );
  }
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
} catch (error) {
  await failureDetails?.();
  throw error;
} finally {
  socket?.close();
  browser?.kill();
  vite?.kill();
  await Promise.allSettled([browser?.exited, vite?.exited]);
  await rm(profile, { recursive: true, force: true });
}
