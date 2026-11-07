// Rendered UI census: selected-state grammar, owning stylesheet, first-content position and
// hit targets on the real app, served by the local Vite dev server with synthetic fixtures.
// No live backend, no real credentials. Not a bun test (needs a browser); run manually:
//   PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/visual-audit/census.mjs [outDir] [--assert]
// Optional: CHROME_EXECUTABLE, ORIGIN (default http://127.0.0.1:5173), SCREENSHOTS=1.
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { installFixtures, login, gotoRoute } from './fixtures.mjs';

const outDir = path.resolve(
  process.argv.slice(2).find((a) => !a.startsWith('--')) ?? path.join(tmpdir(), 'cpamc-census')
);
await fs.mkdir(outDir, { recursive: true });
const playwrightPath = process.env.PLAYWRIGHT_MODULE;
if (!playwrightPath) throw new Error('Set PLAYWRIGHT_MODULE to playwright-core/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightPath));
const origin = process.env.ORIGIN ?? 'http://127.0.0.1:5173';

// Expected-first-content probes. The census reports the top of the first match.
const PAGES = [
  {
    name: 'auth-files',
    route: '/auth-files',
    first: 'main table tbody tr, main [class*="AuthFileCard-module__card"]',
  },
  { name: 'quota', route: '/quota', first: 'main ul[aria-label="Remaining by account"]' },
  { name: 'config', route: '/config', first: 'main [class*="SectionCard-module__card"]' },
  {
    name: 'plugin-store',
    route: '/plugin-store',
    // The browse controls: how far the notices push the registry search down.
    first: 'main input',
  },
  {
    name: 'logs',
    route: '/logs',
    first: 'main [class*="LogsPage-module__logRow"], main [class*="LogsPage-module__rawLog"]',
  },
  {
    name: 'providers',
    route: '/ai-providers',
    first: 'main [class*="ResourceList"], main table tbody tr',
  },
  { name: 'oauth', route: '/oauth', first: 'main section, main article' },
  { name: 'dashboard', route: '/', first: 'main [class*="VitalsStrip-module__strip"]' },
];

const SELECTED_QUERY = [
  'main [aria-pressed]',
  'main [aria-selected]',
  'main [role="radio"]',
  'main [role="tab"]',
  'main [aria-current="page"]',
  'main [aria-checked]:not([role="switch"]):not([type="checkbox"])',
].join(',');

function inPageCensus({ selectedQuery, firstQuery, minTarget }) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const moduleOf = (el) =>
    [...el.classList]
      .map((c) => c.match(/^(.+?)-module__(.+?)___/))
      .filter(Boolean)
      .map((m) => `${m[1]}.${m[2]}`);
  const isSelected = (el) =>
    el.getAttribute('aria-pressed') === 'true' ||
    el.getAttribute('aria-selected') === 'true' ||
    el.getAttribute('aria-checked') === 'true' ||
    el.getAttribute('aria-current') === 'page';
  const style = (el) => {
    const cs = getComputedStyle(el);
    return {
      bg: cs.backgroundColor,
      color: cs.color,
      border: `${cs.borderTopWidth} ${cs.borderTopColor}`,
      borderBottom: `${cs.borderBottomWidth} ${cs.borderBottomColor}`,
      shadow: cs.boxShadow === 'none' ? 'none' : cs.boxShadow.slice(0, 60),
      radius: cs.borderTopLeftRadius,
      weight: cs.fontWeight,
      underline: cs.textDecorationLine,
      height: Math.round(el.getBoundingClientRect().height),
    };
  };
  // Group controls by their nearest group container (role=group/tablist/radiogroup or parent).
  const groups = new Map();
  for (const el of document.querySelectorAll(selectedQuery)) {
    if (!visible(el)) continue;
    const container =
      el.closest('[role="group"],[role="tablist"],[role="radiogroup"],nav,fieldset') ??
      el.parentElement;
    if (!groups.has(container)) groups.set(container, []);
    groups.get(container).push(el);
  }
  const grammar = (sel, un) => {
    if (!sel) return 'no-selected-visible';
    const parts = [];
    if (!un) return 'single';
    const a = style(sel);
    const b = style(un);
    if (a.bg !== b.bg) parts.push('fill');
    if (a.border !== b.border) parts.push('outline');
    if (a.borderBottom !== b.borderBottom && a.border === b.border) parts.push('underline');
    if (a.shadow !== b.shadow) parts.push('raised');
    if (a.color !== b.color) parts.push('ink');
    if (a.weight !== b.weight) parts.push('weight');
    return parts.join('+') || 'NO-VISIBLE-DIFFERENCE';
  };
  const controlGroups = [...groups.entries()].map(([container, els]) => {
    const sel = els.find(isSelected);
    const un = els.find((e) => !isSelected(e));
    const role = els[0].getAttribute('role') ?? els[0].tagName.toLowerCase();
    const attr = ['aria-pressed', 'aria-selected', 'aria-checked', 'aria-current'].find((a) =>
      els[0].hasAttribute(a)
    );
    return {
      label:
        container.getAttribute('aria-label') ??
        container.getAttribute('aria-labelledby') ??
        moduleOf(container).join(' '),
      role,
      attr,
      count: els.length,
      texts: els.map((e) => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 24)),
      owners: [...new Set(els.flatMap(moduleOf))],
      grammar: grammar(sel, un),
      selected: sel ? style(sel) : null,
      unselected: un ? style(un) : null,
      rows: new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size,
      top: Math.round(els[0].getBoundingClientRect().top + scrollY),
    };
  });
  const first = [...document.querySelectorAll(firstQuery)].find(visible);
  const smallTargets = [];
  for (const el of document.querySelectorAll(
    'main button, main a[href], main input:not([type="hidden"]), main select, main [role="button"], main [role="tab"], header button, header a[href]'
  )) {
    if (!visible(el) || el.closest('[aria-hidden="true"]')) continue;
    if (el.matches('[class*="logRow"], .skip-link')) continue;
    // Checkboxes/switches usually take their hit area from the wrapping <label>.
    const target = el.matches('input[type="checkbox"],input[type="radio"]')
      ? (el.closest('label') ?? el)
      : el;
    const r = target.getBoundingClientRect();
    if (Math.min(r.height, r.width) + 0.5 < minTarget) {
      smallTargets.push({
        name: (el.getAttribute('aria-label') ?? el.textContent)
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40),
        w: Math.round(r.width),
        h: Math.round(r.height),
        owner: moduleOf(target).join(' ') || target.className.toString().slice(0, 40),
      });
    }
  }
  return {
    hash: location.hash,
    heading: document.querySelector('main h1')?.textContent ?? null,
    overflow: document.documentElement.scrollWidth > innerWidth,
    firstContentTop: first ? Math.round(first.getBoundingClientRect().top + scrollY) : null,
    firstContentOwner: first ? moduleOf(first).join(' ') : null,
    controlGroups,
    smallTargets,
  };
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE,
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
  locale: 'en-US',
});
await installFixtures(context, origin);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await login(page, origin);

const results = [];
for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
  for (const probe of PAGES) {
    await gotoRoute(page, origin, probe.route);
    const data = await page.evaluate(inPageCensus, {
      selectedQuery: SELECTED_QUERY,
      firstQuery: probe.first,
      minTarget: width === 1440 ? 32 : 44,
    });
    if (process.env.SCREENSHOTS) {
      await page.screenshot({ path: path.join(outDir, `${probe.name}-${width}.png`) });
    }
    results.push({ page: probe.name, width, ...data });
  }
}
await browser.close();

await fs.writeFile(path.join(outDir, 'census.json'), JSON.stringify({ errors, results }, null, 2));
const lines = [];
for (const r of results) {
  lines.push(
    `\n## ${r.page} @${r.width}  first-content y=${r.firstContentTop ?? 'NOT FOUND'} (${r.firstContentOwner ?? '-'})  overflow=${r.overflow}`
  );
  for (const g of r.controlGroups) {
    lines.push(
      `  [${g.grammar}] ${g.role}/${g.attr} "${g.label}" x${g.count} rows=${g.rows} owners=${g.owners.join(',')}`
    );
    if (g.selected) {
      lines.push(
        `     sel bg=${g.selected.bg} border=${g.selected.border} shadow=${g.selected.shadow !== 'none'} h=${g.selected.height}`
      );
    }
  }
  if (r.smallTargets.length) {
    lines.push(`  small targets (<${r.width === 1440 ? 32 : 44}px): ${r.smallTargets.length}`);
    for (const s of r.smallTargets.slice(0, 12)) {
      lines.push(`     ${s.w}x${s.h} "${s.name}" ${s.owner}`);
    }
  }
}
const summary = lines.join('\n');
await fs.writeFile(path.join(outDir, 'census.txt'), summary);
console.log(summary);
if (errors.length) console.error('page errors:', errors);

// Gates: phone first-content positions, one selected-state grammar for single-select
// mode/filter groups (route tabs, aria-current links and chart series toggles are other roles),
// and minimum hit targets. `--assert` exits non-zero when any gate fails.
const at = (pageName, width) => results.find((r) => r.page === pageName && r.width === width);
const GATES = [
  // Phone Logs stacks the title, a Refresh + "Auto refresh" row, the tabs, a full-width search
  // row, then Filters and Options. Full-width search (350px, was 149px en and 102px ru, which cut
  // the ru placeholder) moved the first row from y=283 to y=335.
  ['logs 390 first row near y335', at('logs', 390)?.firstContentTop, (y) => y !== null && y <= 340],
  [
    'auth-files 390 first record',
    at('auth-files', 390)?.firstContentTop,
    (y) => y !== null && y <= 340,
  ],
  [
    'quota 390 account list before chart',
    at('quota', 390)?.firstContentTop,
    (y) => y !== null && y <= 480,
  ],
];
const isModeGroup = (g) =>
  g.attr === 'aria-pressed' &&
  g.count > 1 &&
  !g.owners.some((o) => o.startsWith('TimeSeriesChart.'));
const grammars = new Map();
for (const r of results) {
  for (const g of r.controlGroups.filter(isModeGroup)) {
    const key = `${g.grammar} radius=${g.selected?.radius}`;
    if (!grammars.has(key)) grammars.set(key, []);
    grammars.get(key).push(`${r.page}@${r.width}:${g.label}`);
  }
}
GATES.push(['one single-select grammar', [...grammars.keys()], (keys) => keys.length === 1]);
for (const r of results) {
  GATES.push([`${r.page} ${r.width} small targets`, r.smallTargets.length, (n) => n === 0]);
  GATES.push([`${r.page} ${r.width} no horizontal overflow`, r.overflow, (o) => o === false]);
}
let failed = 0;
console.log('\n# Gates');
for (const [name, value, ok] of GATES) {
  const pass = ok(value);
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(value)}`);
}
console.log('\n# Single-select grammars');
for (const [key, where] of grammars) console.log(`${key}\n   ${where.join('\n   ')}`);
if (process.argv.includes('--assert') && failed) process.exit(1);
