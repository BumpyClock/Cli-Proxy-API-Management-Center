import { useSyncExternalStore } from 'react';
import { createSharedClock } from '@/utils/time/sharedClock';

/**
 * Five-second clock for "updated 15s ago" labels and freshness thresholds.
 *
 * Separate from the app-wide minute clock because data here refreshes every 15
 * seconds; a minute clock would leave the age label lagging the data it describes.
 */
const DASHBOARD_CLOCK = createSharedClock({ intervalMs: 5_000 });

const SERVER_SNAPSHOT = Date.now();
const serverSnapshot = () => SERVER_SNAPSHOT;

export function useDashboardClock(): number {
  return useSyncExternalStore(
    DASHBOARD_CLOCK.subscribe,
    DASHBOARD_CLOCK.getSnapshot,
    serverSnapshot
  );
}
