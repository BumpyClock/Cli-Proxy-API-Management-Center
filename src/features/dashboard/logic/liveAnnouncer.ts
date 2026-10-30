import {
  settleAnnouncement,
  type AnnouncementNext,
  type AnnouncementSnapshot,
  type AnnouncementText,
} from './announce';

export interface AnnouncerTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
  now: () => number;
}

export interface AnnouncerUpdate {
  snapshot: AnnouncementSnapshot;
  next: AnnouncementNext;
  text: AnnouncementText;
  /** Credentials and traffic feed one headline: when each last reported, and whether either is in flight. */
  primary: { credentialsAt: number | null; trafficAt: number | null; busy: boolean };
}

export interface AnnouncerOptions {
  /** Changes and action results within this window are announced together. */
  batchMs: number;
  /** Longest wait for both primary sources before announcing anyway (one poll interval). */
  maxHoldMs: number;
}

/**
 * Decides when the dashboard's live region speaks, and what it says.
 *
 * Credentials and traffic are polled separately but feed one headline, so a change
 * waits until neither is in flight and both have reported since the last announcement
 * (bounded by `maxHoldMs`). The announcement is the net change from the last announced
 * state to the latest one; intermediate states between the two sources are never spoken.
 * Refresh and Retry hold announcements until they end, then their result leads.
 */
export class LiveAnnouncer {
  private announced: AnnouncementSnapshot | null = null;
  private announcedMarks: { credentialsAt: number | null; trafficAt: number | null } | null = null;
  private latest: AnnouncerUpdate | null = null;
  private actionMessages: string[] = [];
  private actionsRunning = 0;
  private actionEnded = false;
  private timer: unknown = null;
  private pendingSince: number | null = null;

  constructor(
    private readonly emit: (message: string) => void,
    private readonly timers: AnnouncerTimers,
    private readonly options: AnnouncerOptions = { batchMs: 500, maxHoldMs: 15_000 }
  ) {}

  /** Feed every settled render. The first one is the silent baseline. */
  update(next: AnnouncerUpdate): void {
    this.latest = next;
    if (!this.announced) {
      this.announced = next.snapshot;
      this.announcedMarks = { ...next.primary };
      return;
    }
    this.schedule();
  }

  actionStarted(): void {
    this.actionsRunning += 1;
  }

  actionFinished(message: string | null): void {
    this.actionsRunning = Math.max(0, this.actionsRunning - 1);
    if (message) this.actionMessages.push(message);
    this.actionEnded = true;
    this.schedule();
  }

  dispose(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.pendingSince === null) this.pendingSince = this.timers.now();
    if (this.timer === null) {
      this.timer = this.timers.set(() => this.flush(), this.options.batchMs);
    }
  }

  private primaryCaughtUp(): boolean {
    const latest = this.latest;
    if (!latest || latest.primary.busy) return false;
    // An action's own result is enough; otherwise both sources must have reported.
    if (this.actionEnded) return true;
    const marks = this.announcedMarks;
    const advanced = (now: number | null, before: number | null) =>
      now !== null && (before === null || now > before);
    return (
      !marks ||
      (advanced(latest.primary.credentialsAt, marks.credentialsAt) &&
        advanced(latest.primary.trafficAt, marks.trafficAt))
    );
  }

  private flush(): void {
    this.timer = null;
    if (this.actionsRunning > 0) return; // the action's end reschedules
    const waited = this.timers.now() - (this.pendingSince ?? this.timers.now());
    if (!this.primaryCaughtUp() && waited < this.options.maxHoldMs) {
      this.timer = this.timers.set(() => this.flush(), this.options.batchMs);
      return;
    }
    const latest = this.latest;
    const previous = this.announced;
    if (latest) {
      this.announced = latest.snapshot;
      this.announcedMarks = { ...latest.primary };
    }
    const message = settleAnnouncement(
      latest && previous ? { previous, next: latest.next, text: latest.text } : null,
      this.actionMessages
    );
    this.actionMessages = [];
    this.actionEnded = false;
    this.pendingSince = null;
    if (message) this.emit(message);
  }
}
