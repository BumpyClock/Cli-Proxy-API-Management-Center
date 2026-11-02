# Changelog

## Unreleased

### Added

- Provider-first quota overview with remaining-capacity charts, next-reset projections, coverage, date navigation, and account-level details. Forecasts assume no further consumption and do not invent history or burn rates.
- GitHub Copilot quota cards and filters, including premium interactions, unlimited chat/completions, plan, and reset dates through the credential-scoped management endpoint.

- Live operations dashboard with evidence-based incidents, direct actions, per-source freshness, local-time traffic charts, and usage insights.
- Keyboard focus containment for stacked dialogs and the mobile drawer, live incident announcements, keyboard header menus, and a skip link.

### Changed

- Neutral dark surfaces, compact quota controls, provider pills, and high-contrast sidebar selection follow the supplied quota-workbench design.

### Fixed

- Dashboard links reveal credentials with missing provider metadata and clear conflicting saved provider and log filters.
- Returning from OAuth editors preserves the Auth Files page after a deep-link URL is cleaned up.
- Dashboard credential rows distinguish auth indices, and model cooldown deadlines remain visible after an earlier credential retry time has passed.
- Dashboard source errors use secret redaction and are limited to 200 characters. Explicitly labelled short secrets and quoted passphrases are also redacted, including truncated values.
- Live announcements report new issues immediately without prematurely announcing recoveries in the same poll.
- Usage totals, latency, and failures use both traffic-window bounds, excluding later requests when traffic data is stale. The panel shows exact bounds and historical cutoffs, and reports unknown counts when retention removed the selected interval. Retained positive usage still proves activity; model totals remain marked as minimums when any API lost coverage.
- Provider deep-link targets retain a visible keyboard focus indicator.
- Clicking an open header menu's trigger closes it without reopening; keyboard Tab and Escape behavior is preserved.
