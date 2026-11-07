# Management workspace

The management frontend keeps the existing Management API, hash routes, provider controls, plugin trust gates and single-file deployment. The UI can be deployed independently by replacing the backend-hosted `management.html`. Backend configuration and provider credentials are unchanged.

## Deploying a custom panel

Before replacing the HTML, prevent the backend updater from restoring an upstream release:

```yaml
remote-management:
  disable-auto-update-panel: true
```

Alternatively, set `remote-management.panel-github-repository` to this fork if you want automatic updates from its releases. The repository must publish a release asset named `management.html`. A branch build alone is not an updater release.

Place the custom `management.html` before the first panel request. A missing file can still trigger a bootstrap download even with automatic updates disabled. The backend resolves its location from `MANAGEMENT_STATIC_PATH`, then `WRITABLE_PATH/static/` (also accepts lowercase `writable_path`), then `static/` beside the backend config. Back up the existing HTML before replacement. These details were checked against the sibling CLIProxyAPIPlus checkout; verify them for other backend versions.

## Operator experience

- Page headers, segmented controls, disclosures, selects and refresh actions use shared owners. Page refresh labels name their scope. The separate global action says "Refresh config & page". Mobile Utilities provides configuration refresh, language, theme and sign out.
- Desktop tables become labeled mobile records. Auth Files keeps credential identity, availability, health and freshness visible. Details and Actions preserve secondary information and operations. Provider selection precedes resource controls on phones.
- Dashboard status describes the sources checked, not an unconditional health verdict. Failed or stale sources retain their attention states. Requests through current credentials and usage-statistics records are separate sources over the same window, with an explanation of their different coverage.
- Quota leads with per-account remaining percentages, limits, reset times and snapshot state. Remaining below 30% is marked Low with text and an icon. Exact overlapping projections share one gray trace and an explicit account-group label. Isolating an account restores its individual stroke. Future values remain projections, not invented usage history.
- Empty request windows retain their time range and data-table access without drawing a fabricated trend. Missing dated Usage history is Not reported, never zero. Usage tables retain request, token, failure and latency evidence.
- Logs accept timestamps with `Z` or an offset and structured `status=200` values. Mobile messages wrap. Options groups display, export and destructive controls. Clear logs retains its confirmation. Each structured record is one keyboard-copy button named with the complete raw line; its visual columns are not separate accessible table cells.
- An accepted OAuth callback resumes login-status polling if an earlier status request failed. Submitting a callback during active polling does not start a second loop.
- OAuth Login has provider search and distinguishes regional Kimi variants. Model editors explain required provider selection beside the field and Save. Login restores the original route query. Editor scroll clearance keeps final fields, dropdowns and keyboard focus above the action bar.
- Config states that edits apply when saved. Plugin disablement has an actionable configuration link. The separate third-party trust warning remains visible and cannot be dismissed. Sponsored resources live on System rather than inside credential fields or onboarding promotions.
- The full product name is CLI Proxy API Management Center, with CPAMC as its short form. Changed text and accessible labels are maintained in English, Simplified Chinese, Traditional Chinese and Russian.

## Maintainer ownership

Design and motion tokens have one owner, `src/design-system/tokens.ts`; see [design-tokens.md](design-tokens.md). `SegmentedControl`, `NativeSelect`, `RefreshButton` and `PageHeader` own shared control patterns. Route tabs remain distinct from mode switches and multi-select filters. `menuFocus.ts` owns shared menu focus behavior. `useFloatingMenuPosition` owns viewport clamping, flipping and scroll/resize positioning for Auth Files and Provider row menus. Open menus portal to the document body; oversized menus scroll within the available viewport. Theme tokens cover referenced custom properties, and regression tests enforce the 12px typography floor.

Claude quota snapshots and timelines prefer the account-wide five-hour and seven-day windows over model-specific limits of the same duration. Provider observations own these preferences; consumers share the existing window selector.

Quota timeline columns follow local calendar boundaries. Column widths reflect elapsed time, including 23-hour and 25-hour days, so date labels and quota bars stay aligned across daylight-saving changes.

Timeline used-quota fills are measured over the full reported window before clipping to the visible date range. Usage outside that range does not create a visible fill, and projected windows do not reuse reported usage.

Quota chart stroke selection and account-list swatches share one resolver. Chart tables mount when opened. Keyboard inspection, account isolation, snapshot provenance and failed-refresh evidence remain available. Existing request ownership and session-isolation guards are preserved.

## Verification

`bun run verify` runs Bun regression tests, ESLint, both TypeScript projects and the production single-file build. Token suites check generated output, whole-tree adoption and injected drift failures. Run the same command in a no-secrets Boat Linux sandbox with Node 24 and Bun 1.3.14 for CI parity. Keep revision-specific results in the PR.

Application runtime dependencies are unchanged. Token tooling adds Node 24 development types. Active language-server probes can be inconclusive; report their coverage rather than treating an empty result as a clean check.

`bun run type-check` checks both the application and Node-based build/token tooling. Date-label tests preload UTC through `bunfig.toml`, including when the host exports another `TZ`; production date formatting still uses the viewer's timezone.

Rerun browser checks against a local Vite server with synthetic fixtures:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
CHROME_EXECUTABLE=/path/to/chromium \
node tests/visual-audit/census.mjs /tmp/cpamc-census --assert

PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
CHROME_EXECUTABLE=/path/to/chromium \
node tests/visual-audit/interactions.mjs
```

The census checks rendered selection styles, control targets, overflow and first-content positions. The interaction script exercises native keyboard, pointer and touch input for menus, cancelled destructive actions, filters, provider-query restoration, quota axes and account isolation, and Utilities focus restoration. These fixtures make no live backend requests and contain no real credentials.

Logs deliberately trades some initial reading space for a full-width mobile search field and the full Auto refresh label. Its final English first-row gate is 340px, compared with 270px in an earlier iteration. This is an explicit layout tradeoff, not an unchanged performance metric.

## Limits

The UI checks did not exercise real account authorization or inference calls. The upstream `../CLIProxyAPI` checkout was unavailable. Panel-updater behavior was checked against the sibling CLIProxyAPIPlus source, not a live backend mutation. Mobbin required authentication, so no Mobbin references were inspected.

Screenshot scores are subjective craft judgments, not usability studies or accessibility certification. Fixtures cover partial quota and plugin states. The static council did not exercise interactions, and its viewport captures do not establish full-page coverage. The implementation lead separately checked selected Chinese and Russian layouts. Full assistive-technology, real-device, translated-layout and live-data coverage remain incomplete.

Known residual issues include dense mobile metadata, a three-line sidebar brand block that exceeds the top-bar height, and pre-existing Escape behavior that leaves an OAuth editor while its model list is open. No claim of complete accessibility or backend validation is made.
