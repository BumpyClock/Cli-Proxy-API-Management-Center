# Changelog

## Unreleased

### Added

- Live operations dashboard with evidence-based incidents, direct actions, per-source freshness, local-time traffic charts, and usage insights.
- Keyboard focus containment for stacked dialogs and the mobile drawer, live incident announcements, keyboard header menus, and a skip link.

### Fixed

- Dashboard links reveal credentials with missing provider metadata and clear conflicting saved provider and log filters.
- Returning from OAuth editors preserves the Auth Files page after a deep-link URL is cleaned up.
- Dashboard credential rows distinguish auth indices, and model cooldown deadlines remain visible after an earlier credential retry time has passed.
- Dashboard source errors use existing secret redaction and are limited to 200 characters. Provider deep-link targets retain a visible keyboard focus indicator.
