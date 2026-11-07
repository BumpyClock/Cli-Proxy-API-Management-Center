# Management workspace

The management frontend keeps the existing Management API, hash routes, provider controls, plugin trust gates and single-file deployment. These UI changes do not deploy the application or change backend configuration.

## Operator experience

- Page headers, segmented controls, disclosures, selects and refresh actions use shared owners. Page refresh labels name their scope. The separate global action says "Refresh config & page". Mobile Utilities provides configuration refresh, language, theme and sign out.
- Desktop tables become labeled mobile records. Auth Files keeps credential identity, availability, health and freshness visible. Details and Actions preserve secondary information and operations. Provider selection precedes resource controls on phones.
- Dashboard status describes the sources checked, not an unconditional health verdict. Failed or stale sources retain their attention states. Requests through current credentials and usage-statistics records are separate sources over the same window, with an explanation of their different coverage.
- Quota leads with per-account remaining percentages, limits, reset times and snapshot state. Remaining below 30% is marked Low with text and an icon. Exact overlapping projections share one gray trace and an explicit account-group label. Isolating an account restores its individual stroke. Future values remain projections, not invented usage history.
- Empty request windows retain their time range and data-table access without drawing a fabricated trend. Missing dated Usage history is Not reported, never zero. Usage tables retain request, token, failure and latency evidence.
- Logs accept timestamps with `Z` or an offset and structured `status=200` values. Mobile messages wrap. Options groups display, export and destructive controls. Clear logs retains its confirmation.
- OAuth Login has provider search and distinguishes regional Kimi variants. Model editors explain required provider selection beside the field and Save. Login restores the original route query. Editor scroll clearance keeps final fields, dropdowns and keyboard focus above the action bar.
- Config states that edits apply when saved. Plugin disablement has an actionable configuration link. The separate third-party trust warning remains visible and cannot be dismissed. Sponsored resources live on System rather than inside credential fields or onboarding promotions.
- The full product name is CLI Proxy API Management Center, with CPAMC as its short form. Changed text and accessible labels are maintained in English, Simplified Chinese, Traditional Chinese and Russian.

## Maintainer ownership

`SegmentedControl`, `NativeSelect`, `RefreshButton` and `PageHeader` own shared control patterns. Route tabs remain distinct from mode switches and multi-select filters. `menuFocus.ts` owns shared menu focus behavior. Theme tokens cover referenced custom properties, and regression tests enforce the 12px typography floor.

Quota chart stroke selection and account-list swatches share one resolver. Chart tables mount when opened. Keyboard inspection, account isolation, snapshot provenance and failed-refresh evidence remain available. Existing request ownership and session-isolation guards are preserved.

## Verification

The final implementation passed `bun run verify` with Bun 1.3.14. It ran 1,494 tests, ESLint, TypeScript compilation and the production single-file build. The implementation lead also ran the same checks in a no-secrets Boat Linux sandbox using Node 24. No dependency or lockfile changes were required.

The coordinating agent reran the full local verification, native browser interactions and rendered census. Active diagnostics were also probed. Some TypeScript-server clean results were inconclusive; compilation passed. Auxiliary analysis reported two style warnings in the chart model, not compilation failures.

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

## Design council and screenshots

Six independent review rounds used the same 12-metric prompt, changing only the round and evidence path. GPT-6.1 Sol high, Muse Wonder Full 1.0 and Claude Opus 5.5 reviewed each round in parallel. New reviewer contexts received no previous scores. Five Opus-led implementation passes followed the first five rounds.

The council assessed 34 viewport screenshots per round. Coverage includes login and 14 authenticated routes at 1440 × 1000 and 390 × 844, plus four desktop dark-theme routes. An initial invalid capture packet was excluded after route-content identity checks exposed repeated Dashboard content. The corrected harness reloads each route and validates its identity before capture.

See [council results and before/after evidence](../design-review/council/README.md). All screenshots use local synthetic data. Intermediate captures remain local; the PR preserves the first valid and final captures.

## Limits

No live backend integration, real account authorization, inference calls or deployment was performed. The authoritative sibling backend checkout was unavailable. Mobbin required authentication, so no Mobbin references were inspected.

Screenshot scores are subjective craft judgments, not usability studies or accessibility certification. Fixtures cover partial quota and plugin states. The static council did not exercise interactions, and its viewport captures do not establish full-page coverage. The implementation lead separately checked selected Chinese and Russian layouts. Full assistive-technology, real-device, translated-layout and live-data coverage remain incomplete.

Known residual issues include dense mobile metadata, a three-line sidebar brand block that exceeds the top-bar height, and pre-existing Escape behavior that leaves an OAuth editor while its model list is open. No claim of complete accessibility or backend validation is made.
