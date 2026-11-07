# UI design council

Six blinded design-review rounds, with five Opus-led fix passes. Each round used the same [12-metric prompt](review-prompt.txt), changing only the round and evidence path. New reviewer contexts received no previous scores. GPT-6.1 Sol high, Muse Wonder Full 1.0 and Claude Opus 5.5 ran in parallel.

`state.json` records arithmetic means calculated from the 12 raw metric values, not the rounded overall supplied by each reviewer. `summarize.mjs` validates and recomputes the results. Scores are subjective screenshot-scope judgments, not usability studies or accessibility certification.

## Outcome

Final council mean **8.12/10**, from **6.92/10** in round 1. The **9.00 target was not reached**. Stopped at the requested six-round cap. See [round scores and all 12 final metrics](results.md).

## Before and after

All images use local synthetic fixtures. No live credentials or production screenshots are included. Each pair preserves the original screenshot dimensions. The first valid round is Before; round 6 is After.

| Screen | Comparison |
| --- | --- |
| Dashboard, desktop | [Before / after](media/dashboard-1440-before-after.png) |
| Providers, desktop | [Before / after](media/providers-1440-before-after.png) |
| Quota, desktop | [Before / after](media/quota-1440-before-after.png) |
| Config, dark desktop | [Before / after](media/config-dark-1440-before-after.png) |
| Auth Files, mobile | [Before / after](media/auth-files-390-before-after.png) |
| Logs, mobile | [Before / after](media/logs-390-before-after.png) |
| OAuth aliases, mobile | [Before / after](media/oauth-model-alias-390-before-after.png) |

Full captures are preserved in [round 1](round-1/screenshots/) and [round 6](round-6/screenshots/), with 34 PNGs each. Intermediate PNGs and the invalid initial capture packet remain local and are excluded from Git. Their capture facts and review reports remain available in the round folders.

## Method and limits

Desktop capture is 1440 × 1000; mobile is 390 × 844. Coverage includes login and 14 authenticated routes at both widths, plus Dashboard, Providers, Quota and Config in desktop dark mode. Captures are viewport-only, reduced motion, English, using a real local Vite app with intercepted synthetic API responses. Quota and plugin fixtures are partial.

An invalid initial packet repeated Dashboard content after hash-only navigation. It was excluded, and its reviews were discarded. The corrected harness reloads each route, waits for authenticated content and validates route/heading identity. This was a capture limitation, not evidence of a production routing defect.

Mobbin was authentication-blocked. No Mobbin references or live backend were used. Council members did not exercise interactions. Separate native-input checks cover selected keyboard, pointer and touch behavior; see [verification](verification.json) and [workspace documentation](../../docs/workspace-redesign.md).

Some reviewer suggestions were rejected where they conflicted with source evidence or truthful data display. Examples include labeling same-window usage as since-restart totals, inventing authorization status, drawing distinguishable traces for exactly overlapping values, and converting unavailable success rate into 0%.

## Reproduce

With local Vite running at `http://127.0.0.1:5173`:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
CHROME_EXECUTABLE=/path/to/chromium \
node design-review/council/capture.mjs 6

node design-review/council/summarize.mjs 6
python3 design-review/council/build-comparisons.py
```

The screenshot capture requires an installed Playwright Core and Chromium. The comparison builder requires Pillow. These review tools are not production dependencies. Each round’s `reviews.json` preserves all three exact raw reviewer transcripts and must exist before summarization. Rerunning captures replaces the local images; preserve the reviewed revision before doing so.
