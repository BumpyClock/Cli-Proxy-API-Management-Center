# Whole-app redesign review

Design exploration only. Production source, deployed UI, backend configuration, and credentials are unchanged.

## Review artifacts

- `redesign.html` is the proposed interactive app. Open it directly in a browser. It contains sample data and makes no live changes.
- `critique.md` records the designer's audit before proposing the redesign.
- `design-notes.md` explains the proposed visual system, chart-library evaluation, coverage, and limits.
- `terra-critique.md` records the requested GPT-6.1 Terra high-reasoning UX critique. Its four recommendations were addressed in one final iteration.
- `screenshots.html` is an offline gallery of 30 current-UI screenshots across 15 page views at desktop and mobile sizes.
- `manifest.json` and `manifest-mobile.json` record routes, viewport sizes, redacted visible text, and screenshot paths.

## Capture scope

Authenticated Railway UI, using the existing Chrome profile through `mcporter` and Chrome DevTools. No account login, provider authorization, installation, deletion, settings save, or quota refresh was initiated. Normal page loads can issue their existing read requests.

Desktop viewport is 1440 × 1000 CSS pixels. Mobile viewport is 390 × 844 CSS pixels. Browser full-page capture is used where practical. Nested scrolling regions retain their first viewport. The long mobile Plugin Store catalog is captured at its first viewport because the browser rejected the full-height image.

The login screen is captured from the local production `dist/index.html` artifact. The authenticated Railway app redirects its login route back to the dashboard. This avoids logging out an active session. The file-based URL visible in the login screenshot is a local-capture artifact, not a verified production defect.

No plugins were installed. Dynamic `/plugin-pages/:pluginId/:menuIndex` views therefore have source-only coverage, not an invented current screenshot. `/dashboard` duplicates `/`; `/settings` and `/api-keys` redirect to `/config`. Wildcard routes are redirects, not additional distinct screens.

Email addresses, account names in credential filenames, deployment URLs, IP addresses, API-key fingerprints, and long token-like values are redacted in the DOM before capture. Text inputs are visually masked and raw config editors blurred. Capture masking changes only the temporary inspection tab's DOM, not persisted configuration or application source. Screenshots remain private operational evidence, not public assets.

Initial hash-only navigation in a background inspection tab produced stale page content. Those captures were replaced. The capture script now reloads each route and verifies the resulting hash before saving. No production rendering defect is inferred from that capture limitation.

## Repeat captures

List existing Chrome pages without printing sensitive URL query strings. Open one clean production inspection tab and a separate local build login tab through Chrome DevTools. Supply their IDs below. Do not log out an existing tab.

```sh
python3 design-review/capture-current.py --page-id PRODUCTION_PAGE_ID --login-page-id LOCAL_LOGIN_PAGE_ID
python3 design-review/capture-current.py --page-id PRODUCTION_PAGE_ID --login-page-id LOCAL_LOGIN_PAGE_ID --mobile
python3 design-review/build-gallery.py
```

Use `--only providers,quota` to recapture selected page names while retaining other manifest entries. Close inspection tabs after completing the audit.

## Verification

- `python3 -I design-review/verify-prototype.py` passed static checks. No external assets or network APIs in the prototype.
- `window.__cpamcSelfTest()` passed in the existing Chrome profile at 1440, 728, and 390 CSS pixels. Each run covered 16 routes and 25 data-state render cases, plus form validation, local configuration saves, deep links, dialogs, and preserved third-party plugin typed confirmation.
- All 16 routes were swept at each width. No missing page headings or document-level horizontal overflow were observed. Dense tables can scroll within their own regions.
- Native Escape closed the mobile navigation drawer and returned focus to its trigger. Native Enter retained focus on a chart-series toggle; Tab reached the graph once, ArrowRight updated its announced value, and the next Tab reached the exact data table. Reduced-motion emulation left content visible with page animation disabled.
- `proposed/final/verification.json` records final fresh-load self-tests, automatic refresh, partial-failure wording, filter deduplication, native chart keyboard input, absent top/sidebar connection badges, light/dark chart-token contrast, and reduced motion. Final screenshots are beside it. Earlier verification and layout sweeps remain in `proposed/`. `preview.html` presents selected read-only captures; `redesign.html` is the full interactive artifact.
- An earlier sequential verification run encountered state-dependent failures in the prototype's internal test fixture. Final per-width self-tests used fresh reloads. Passing fresh-load tests are not proof of arbitrary cross-test state isolation.
- Source review corrected an initial screenshot-only inference about plugin installation. Production already has install options and a three-step third-party trust gate. Both are preserved in the prototype.
- Screen-reader output, full keyboard traversal, real-device touch behavior, translated layouts, and backend integration were not verified. No production build or deployment was needed because production code is unchanged.

Production implementation awaits review and approval of the HTML prototype.
