# Quota workspace

Quota checks run once when the route receives its first accepted auth-file list for the current connection. Re-entering the route checks again. Checks use every eligible account, independent of filters, sorting and pagination. There is no background polling. Refresh all first reloads auth files so snapshot-backed providers receive current backend usage.

A shared per-credential request owner handles batch and individual observations. Concurrent consumers join in-flight reads; invalidated or superseded responses cannot overwrite accepted snapshots. Snapshot-backed account refreshes, including Qoder, reload auth files before reading usage. Failed list reads retain stale values without advancing successful timestamps.

Bulk observations publish loading and settled snapshots once per provider. Each provider waits for its slowest newly owned read before publishing settled results; row actions that join those reads also wait. Other providers and unrelated single-account requests remain independent. Ownership and generation checks run again at publication, and cached successful values remain visible throughout.

Automatic checks are non-generative. xAI billing observations never fall back to inference. A separate, explicitly labeled API health action warns that its inference request may incur charges.

The provider adapters define read semantics; the batch loader only collects outcomes. Disabled, unsupported and ineligible credentials are skipped. The completion line reports the check time, successful checks, failures and skipped credentials. A failed auth-file list read does not start quota checks.

Successful snapshots remain visible during checks. A failed quota refresh retains the last successful provider payload, its successful check time and a stale label. A failure without a successful snapshot remains an error. Existing connection-generation and per-file invalidation guards still govern commits.

The integrated chart plots independent account percentages on a fixed 0 to 100 scale. Weekly spans seven days; session spans five hours. Provider observations choose the displayed window and its label remains in the exact account table. A dashed step projects only the next reported reset, assuming no further use. Stale snapshots do not project a reset. Unknown, unlimited, failed-without-data and expired allowances are absent, not zero. No history, repeated resets, consumption forecasts, or transferable credit pool is inferred.

Account series numbers are allocated by credential identity when a list is accepted and retained through filtering, sorting, pagination and subsequent list reads. Series retain their own sparse reset points rather than a shared account-by-reset matrix. Exact account evidence stays below the plot and replaces the chart's duplicate data-table disclosure. Account details retain all provider bodies, reset-credit controls and the existing windows timeline.

The workspace uses the installed shared `src/components/ui/TimeSeriesChart.tsx` and the pinned Recharts dependency in `package.json` and `bun.lock`. Quota and chart messages ship in all four `src/i18n/locales/` bundles. Product tests load those bundles through isolated i18next instances; no design-review translation artifacts are required.

Release context. This redesign supersedes manual-only entry behavior for eligible accounts. Provider endpoints, payloads and reset contracts remain provider-owned.

Regression checks. `bun test tests/quota*.test.ts tests/timeSeriesChart.test.ts tests/dashboardQuotaSummary.test.ts tests/productionLocales.test.ts`. Locale parity checks cover shipped keys and interpolation variables, including in-memory missing-key and interpolation negatives. Collapsed chart evidence is lazy; Quota uses its existing exact account table instead of mounting a second projection table.
