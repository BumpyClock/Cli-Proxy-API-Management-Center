# Changelog

## Unreleased

### Added

- Shared Recharts time-series charts with numbered series, keyboard point inspection, reduced-motion support, and accessible data tables. Dashboard quota uses the same authoritative account/reset model as Quota Management.

- Provider-first quota overview with remaining-capacity charts, next-reset projections, coverage, date navigation, and account-level details. Forecasts assume no further consumption and do not invent history or burn rates.
- GitHub Copilot quota cards and filters, including premium interactions, unlimited chat/completions, plan, and reset dates through the credential-scoped management endpoint.

- Live operations dashboard with evidence-based incidents, direct actions, per-source freshness, local-time traffic charts, and usage insights.
- Keyboard focus containment for stacked dialogs and the mobile drawer, live incident announcements, keyboard header menus, and a skip link.

### Changed

- Healthy dashboards use a neutral heading and omit the empty attention panel. Actual incidents and first-time provider setup remain visible.

- Redesigned the application shell and route workspaces with consistent headers, compact desktop comparison tables, adaptive mobile rows, section-based settings, calmer diagnostics, and distinct action, warning, failure, and chart colors across all themes and locales. Healthy connection badges no longer occupy the sidebar or header.
- Quota checks now run automatically on route entry, retain cached snapshots during refresh, and report partial outcomes and timestamps. Graphs compare independent accounts on a fixed 0–100% scale; filter, search, window, and series changes do not refetch.
- Usage distinguishes collection-off, unknown, empty, failed, stale, and live states. History uses only backend-dated buckets, retains same-session snapshots on failure, and keeps identifiers masked.

- Neutral dark surfaces, compact quota controls, provider pills, and high-contrast sidebar selection follow the supplied quota-workbench design.

### Fixed

- Bulk quota observations publish immutable provider snapshots in two phases rather than copying the entire cache for every account. Cached 403/404 failures retain translated remediation guidance.
- Plugin resources clear the fixed application header and fit the remaining viewport. Active provider subtitles retain full contrast.

- Paid xAI accounts without observable allowances are skipped rather than marked failed. Plugin frame state resets by resource identity, and Usage exits loading when a connection stops.
- Restored responsive table headings, touch targets, sticky navigation clearance, translated log-copy controls, disabled input styling, and light-theme text contrast.

- Quota observations share per-credential request ownership across routes and account actions. Invalidated or superseded responses cannot replace newer snapshots.
- Automatic xAI checks never send inference requests. Paid health testing requires a separate action labeled with its potential cost.
- Snapshot-backed account refreshes reload authoritative auth-file usage before recording success. Quota projections stay sparse, evidence tables mount on demand, and account window labels use shipped translations.

- Provider-level quota refresh reloads authoritative auth-file snapshots before querying the current page, including updated Qoder usage.
- Copilot reset dates reject impossible calendar dates while preserving valid leap days and timezone offsets.
- Active sidebar plugin drawer carets retain the selected foreground color.

- Dashboard links reveal credentials with missing provider metadata and clear conflicting saved provider and log filters.
- Returning from OAuth editors preserves the Auth Files page after a deep-link URL is cleaned up.
- Dashboard credential rows distinguish auth indices, and model cooldown deadlines remain visible after an earlier credential retry time has passed.
- Dashboard source errors use secret redaction and are limited to 200 characters. Explicitly labelled short secrets and quoted passphrases are also redacted, including truncated values.
- Live announcements report new issues immediately without prematurely announcing recoveries in the same poll.
- Usage totals, latency, and failures use both traffic-window bounds, excluding later requests when traffic data is stale. The panel shows exact bounds and historical cutoffs, and reports unknown counts when retention removed the selected interval. Retained positive usage still proves activity; model totals remain marked as minimums when any API lost coverage.
- Provider deep-link targets retain a visible keyboard focus indicator.
- Clicking an open header menu's trigger closes it without reopening; keyboard Tab and Escape behavior is preserved.
