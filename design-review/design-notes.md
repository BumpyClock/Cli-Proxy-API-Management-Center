# CPAMC redesign notes

Companion to `critique.md` and `redesign.html`. Read the critique first. This file records the chosen direction, the system, the state model, and every proposal that changes IA, naming, or content. Nothing here changes production code.

## Who this is for

The operator of a CLI Proxy API backend. They need to answer three questions fast: is traffic flowing, which credential or provider is the problem, and what do I change. The next engineer inherits one page header, one state model, one table pattern, and one set of semantic tokens instead of per-page styling.

## Mode

Targeted overhaul (redesign protocol "Overhaul"). IA, routes, nav labels, group labels, logo, and field names stay. Visual language, page structure, and state handling change.

## Direction. Instrument panel

Precise, calm, dense. Dark first, light equal. The direction extends the Dashboard that already ships (`current/dashboard.png`), because it is the only page that states coverage, freshness, and caveats honestly.

- **Ink primary.** The primary button fills with the foreground color (near white on dark, near black on light). It extends the white "Upload File" and "Refresh all credentials" pills that newer pages already use, and it fixes the 3.61:1 gray primary.
- **Brand cyan as accent.** Taken from the logo gradient. It marks focus rings, the active nav item, links, and the first chart series. It is never a status color.
- **Semantic colors with distinct roles.** Success green, warning amber, error red, info blue. Each pairs with an icon and a word.
- **Mono for machine values.** Versions, file names, YAML keys, timestamps, routes, counts in status lines. Sans for everything a person reads.
- **Tables where operators compare rows.** Auth Files, providers, logs, quota, usage, models. Cards only for true peers that hold mixed content (plugin store, OAuth login options).
- **Hairline borders, no shadows on dark.** Depth from surface steps (`--background`, `--card`, `--secondary`).

Alternatives considered and rejected:

- *Warm paper console* (the light theme's current `#faf9f5` paper). Calm, but the gray primary problem is rooted there, and dark is the observed default.
- *Bold brand gradient* (yellow to cyan chrome). Memorable, but loud for a tool opened many times a day, and it turns status color into decoration.

## Tokens

Declared on `#root[data-theme]` inside the prototype. Names follow the brief plus project aliases.

| Role | Dark | Light | Notes |
|---|---|---|---|
| `--background` | `#0d0f11` | `#fbfaf7` | App surface. Light keeps a trace of the current paper warmth. |
| `--card` | `#14171a` | `#ffffff` | Panels and tables. |
| `--secondary` | `#1b1f23` | `#f2f0eb` | Secondary buttons, hover rows. |
| `--muted` | `#1b1f23` | `#f2f0eb` | Muted surface. Text uses `--muted-foreground`. |
| `--foreground` | `#eceef0` | `#1d1b18` | Body text. |
| `--muted-foreground` | `#9aa1a9` | `#625d56` | Secondary text, at least 4.5:1 on card. |
| `--border` | `#252a2f` | `#e4e0d8` | Hairlines. |
| `--ring` | `#5cc8db` | `#0b7285` | Focus ring, 2px, offset 2px. |
| `--primary` | `#eceef0` | `#1d1b18` | Ink button fill. |
| `--accent` | `#5cc8db` | `#0b7285` | Brand cyan. |
| `--success` | `#3ccf8e` | `#1a7f4e` | Serving, ok. |
| `--warning` | `#e8a93b` | `#8f5a00` | Needs a look, stale, caveat. |
| `--destructive` | `#f06a5b` | `#b83a2b` | Failure, destructive action. |
| `--info` | `#7cb3ff` | `#1f5fbf` | Neutral notices. |
| `--code-background` | `#0a0c0e` | `#f4f2ed` | Logs, YAML, keys. |
| `--chart-1..6` | cyan, green, amber, red, violet, brand yellow | darker steps | Series order is fixed app-wide. |
| `--radius` | `8px` | `8px` | Controls 6px, panels 8px, dialogs 12px. |
| `--font-sans` | system stack | same | Project stack from `src/styles/variables.scss`. |
| `--font-mono` | `ui-monospace` stack | same | Project stack. |

Type roles: page title 22/28 semibold, dashboard headline 30/36, section title 14/20 semibold, body 14/20, dense table 13/18, metadata 12/16 mono. No all-caps eyebrows except the four nav group labels, which are existing identity.

Spacing: 4px grid. Page padding 32 desktop, 16 mobile. Section gap 24. In-panel gap 12.

## Shared page header

Every route uses the same header: title, one mono status line (counts, sync, freshness, and a "Sample data" tag in the prototype), then actions on the right in a fixed order. Secondary actions sit left of the single primary. One refresh per page, next to its freshness stamp.

## Data state model

One model for every data region. The prototype implements it on Usage, Dashboard usage panel, Quota rows, and plugin resource pages.

| State | Meaning | What the operator sees | Next action |
|---|---|---|---|
| Unknown support | Backend does not report this capability (`enabled === null`). | "This backend does not report usage statistics." | Link to System info for versions. |
| Off | Capability exists but collection is disabled. | Status line says "Collection off". Charts replaced by an explanation. No zeros. | "Turn on in Config" deep link to `usage-statistics-enabled`. |
| Loading | First fetch in flight. | Skeleton rows with "Loading" label. | None. |
| Empty | On, no events yet. | "On since 07:12. No requests recorded yet." | Send a test request (doc link). |
| Live | On, data present. | Values, charts, tables, with coverage ("in memory since backend start"). | Refresh. |
| Stale | Last refresh failed or snapshot is old. | Values stay, marked "Last updated 18 min ago" in warning. | Retry. |
| Error | Fetch failed and no prior data. | Error text with status code and retry. | Retry. |

Coverage note is always present in Live and Empty. Usage is in memory, resets on backend restart, and is never backfilled after enabling.

## Proposals (not silently applied)

Each is visible in the prototype with a "Proposal" tag so reviewers can tell it apart from preserved behavior.

1. **Quick Start setup checklist.** Keep the APIKEY.FUN block and the dynamic nav label. Add a four-step checklist below it derived from live state: provider configured, credential serving, client API key present, first request seen. Reason: the current page offers no setup path (critique 11).
2. **Remove the global header refresh icon.** Keep one refresh per page next to its freshness stamp. Reason: critique 6. Risk: muscle memory for the header icon. The prototype keeps a "Refresh page" command on each page header.
3. **Auth Files sub-navigation.** Show "Credentials", "OAuth Model Disablement", and "OAuth Model Aliases" as a tab row at the top of Auth Files. Routes stay `/auth-files`, `/auth-files/oauth-excluded`, `/auth-files/oauth-model-alias`. Today both editors are reachable only from panels below the fold.
4. **Config section rail.** On desktop, list the eight Config sections in a vertical rail so none truncates. Same labels, same order, same Visual/Source modes. Tabs remain on narrow widths.
5. **OAuth Login uniform list.** Sponsor sign-up links become secondary text links. Every provider row shows existing credential count and flow type.
6. **Restyled install preview.** Preserve the existing install-options preview and third-party three-step trust gate. Show publisher, source, version, license, trust, and access consequences. Third-party installs still require identity review, an explicit trust acknowledgment, and typed plugin identity. The prototype changes presentation, not the security requirement.
7. **Sponsor content out of form labels.** The "BestProxy.com" badge moves from the Proxy URL label to a separate, dismissible note under the field.
8. **Page titles.** Production titles differ from nav labels ("Auth Files Management" vs "Auth Files", "Plugin Management" vs "Plugins"). The prototype keeps the production titles. Aligning them is a possible follow-up, not applied.

Unchanged on purpose: all twelve nav labels and their order, four group labels, the conditional "Plugins" page group for plugin resource pages, the logo, route slugs, config field names, and YAML keys.

## Screen inventory in the prototype

| Route | Production page | Prototype notes |
|---|---|---|
| `#/` | Dashboard | Status headline, attention list, KPI band with caveat moved below, throughput chart with data table, provider health, credential status, usage panel tied to the usage state selector. |
| `#/quick-start` | Quick Start | APIKEY.FUN block plus setup checklist (proposal 1). |
| `#/ai-providers` | AI Providers | Configured families first, neutral zeros, resource table, search, model filter, sort, add/edit dialog with validation and safe cancel, detail drawer. |
| `#/auth-files` | Auth Files | Credential table, provider tabs, status filter, search, selection with bulk bar, enable switch, detail drawer, upload dialog. |
| `#/auth-files/oauth-excluded` | OAuth Model Disablement | Provider pick, model checklist, wildcard rules, live preview, local save. |
| `#/auth-files/oauth-model-alias` | OAuth Model Aliases | Alias rows with validation, List and Diagram views, local save. |
| `#/oauth` | OAuth Login | Uniform list, device-code dialog with cancel. |
| `#/quota` | Quota Management | Integrated multi-account chart, shared 0 to 100% axes, reset-only dashed projections, series toggles, exact account breakdown, automatic refresh on entry with cached snapshots retained. Remaining/Accounts and Weekly/5-hour toggles preserved. |
| `#/usage` | Usage Statistics | Seven-state selector, coverage note, honest charts, tables. |
| `#/logs` | Logs Viewer | Log Content and Error Request Logs tabs, one-row toolbar, aligned table, expandable rows, confirm before Clear. |
| `#/config` | Config Panel | Eight sections, Visual/Source, search, dirty count, Review Changes dialog, local-only save, field validation. |
| `#/plugins` | Plugins | Sample installed list or observed empty state, detail drawer, resource links. |
| `#/plugin-store` | Plugin Store | Trust banner, filters, search, install preview, preserved three-step third-party trust gate and typed identity confirmation. |
| `#/plugin-pages/privacy-filter/0` | Plugin resource page | Representative plugin page. Loaded, not found, empty URL, load failed, and plugins unsupported states. |
| `#/system` | Management Center Info | Facts table with copy, update check, links, grouped models, local login data. |
| `#/login` | Login | Centered form, detected backend, custom URL, key reveal, remember note, validation, mock sign in. |

## Chart and quota-entry refinement

Requested after the initial review. One integrated Quota graph replaces the stack of provider panels. Every account keeps its own allowance. Solid dots are reported snapshots; hollow dots mark stale snapshots. Dashed step lines project only the next reported reset, assuming no further consumption. No historical quota consumption or repeated resets are invented. The graph fixes the vertical domain at 0 to 100%. Monthly resets outside the selected range do not get an invented weekly reset.

Dashboard uses the same visual treatment with successful and failed requests per actual sample 10-minute bucket. It has 1-hour and full-window controls, series toggles, crosshair inspection, and an exact data table. These are bucket counts, not an invented instantaneous requests-per-second feed.

Quota checks start automatically on page entry. Existing snapshots remain visible during the check. Successful accounts update without hiding failed or unsupported accounts; disabled accounts are not checked. Filter, search, chart series, and Weekly/5-hour changes do not start another batch. Re-entering the page checks again. Refresh now is an optional retry, not a prerequisite for seeing data. No background polling is proposed. Production should reuse the existing quota batch loader and its connection-generation isolation rather than create a second request path. The prototype simulates these checks locally and makes no network requests.

### Existing component evaluation

- [Liveline](https://benji.org/liveline), [official README](https://github.com/benjitaylor/liveline), and [public types](https://raw.githubusercontent.com/benjitaylor/liveline/main/src/types.ts) were inspected. MIT, React 18+, canvas, no dependencies beyond React, multi-series, hover inspection, loading, pause, and time windows. Strong fit for an actual live stream. Its published series API does not expose per-series dashed/step interpolation or explicit fixed axis bounds. That makes it a less direct fit for quota resets and missing-data semantics. No documented reduced-motion prop was found in those types.
- [Recharts](https://github.com/recharts/recharts), [Line documentation](https://recharts.github.io/en-US/api/Line/), and its Curve source were inspected. MIT and React/SVG. It supports stepAfter, dashed lines, missing-data gaps, responsive axes, tooltips, and accessibility controls. Recommended production candidate for one shared chart system across Quota, Dashboard, and Usage. A version must be pinned and verified with React 19 and the single-file build before implementation; no package was installed in this design phase.

The self-contained HTML deliberately uses inline SVG to demonstrate the intended chart appearance and interaction, not a bundled or fake claim of running either React library. Recharts is the proposed implementation, not an installed dependency. The visual treatment borrows Liveline's quiet axes and integrated series controls without its decorative pulse, momentum, particles, or autoscaled quota percentages.

## Final critique iteration

GPT-6.1 Terra with high reasoning reviewed all 16 desktop captures plus Quota and Dashboard at tablet and phone widths using `ux-designer`. Findings are preserved in `terra-critique.md`. One final iteration applied its four recommendations.

- Refresh completion now states the check time and outcome counts. The sample mixed result is three updated, one failed, one unsupported skipped, and one disabled skipped. Partial results use a warning indicator, not an unconditional green success. Successful account rows receive explicit check timestamps.
- Chart series toggles restore focus to the same control. Each line chart has one Tab stop with Left/Right, Home/End inspection and an announced readout. The next Tab reaches the exact data table instead of visiting every point.
- Stable numbered series labels appear in legends and on the lines. Distinct dash patterns add another cue. The quota header states the no-further-use projection assumption before the plot.
- Account filters and prototype-only scenarios use native disclosures. Mobile series controls use two columns and the optional refresh action stays with the heading. The quota plot was verified inside a 390 by 844 viewport without reducing text size or removing account evidence.

A subsequent user request removed both persistent healthy connection indicators from the sidebar and top bar. Backend host/version context remains in the sidebar footer, and connection details remain available in Management Center Info.

Final browser evidence is `proposed/final/verification.json`; screenshots are beside it. These changes affect the review prototype only. Production code, dependencies, configuration, and deployment remain unchanged.

## Known limits of the prototype

- All data is sample data. No request leaves the file. External links are disabled and say so.
- Native dialogs center in the browser viewport. When embedded in a content-height frame, a dialog can open outside the visible area. Standalone use at 1440 is the reference.
- Language selector changes nothing. The prototype is English only. Production must keep `en`, `zh-CN`, `zh-TW`, and `ru` in sync for every new key.
- The diagram view for aliases is a simplified illustration, not a layout engine.

## Implementation order (suggested)

1. Tokens and the primary/semantic color fix (smallest diff, largest contrast win).
2. Shared page header and one content grid.
3. Usage collection state model (closes the confirmed production issue).
4. Shared time-series chart used by Dashboard and Usage.
5. Auth Files table and drawer.
6. Logs toolbar and table.
7. Remaining pages.
