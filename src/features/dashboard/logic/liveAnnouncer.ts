import {
  sameAnnouncementState,
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

type Marks = { credentialsAt: number | null; trafficAt: number | null };

const advanced = (now: number | null, before: number | null) =>
  now !== null && (before === null || now > before);

/**
 * Decides when the dashboard's live region speaks, and what it says.
 *
 * Credentials and traffic are polled separately but feed one headline. When the latest
 * state first differs from the announced one, the change is held until neither source is
 * in flight and both have reported after the change began (a report from before it does
 * not count), bounded by `maxHoldMs` from the change, never from an unchanged poll. The
 * announcement is the net change from the announced state to the latest one, so states
 * between the two sources' reports are never spoken. Refresh and Retry hold announcements
 * until they end; then their result leads.
 */
export class LiveAnnouncer {
  private announced: AnnouncementSnapshot | null = null;
  private latest: AnnouncerUpdate | null = null;
  private lastMarks: Marks | null = null;
  /** Receipt marks just before the pending change was first seen. */
  private changeBase: Marks | null = null;
  private changeStartedAt: number | null = null;
  private actionMessages: string[] = [];
  private actionsRunning = 0;
  private actionEnded = false;
  private timer: unknown = null;

  constructor(
    private readonly emit: (message: string) => void,
    private readonly timers: AnnouncerTimers,
    private readonly options: AnnouncerOptions = { batchMs: 500, maxHoldMs: 15_000 }
  ) {}

  /** Feed every settled render. The first one is the silent baseline. */
  update(next: AnnouncerUpdate): void {
    const previousMarks = this.lastMarks;
    this.latest = next;
    this.lastMarks = {
      credentialsAt: next.primary.credentialsAt,
      trafficAt: next.primary.trafficAt,
    };
    if (!this.announced) {
      this.announced = next.snapshot;
      return;
    }
    if (sameAnnouncementState(this.announced, next.snapshot)) {
      // An unchanged poll, or a change that reverted: nothing is pending for the state.
      this.changeBase = null;
      this.changeStartedAt = null;
      if (this.actionEnded) this.schedule();
      return;
    }
    if (this.changeStartedAt === null) {
      this.changeStartedAt = this.timers.now();
      this.changeBase = previousMarks ?? { credentialsAt: null, trafficAt: null };
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
    if (this.timer === null) {
      this.timer = this.timers.set(() => this.flush(), this.options.batchMs);
    }
  }

  private ready(): boolean {
    const latest = this.latest;
    if (!latest || latest.primary.busy) return false;
    // A finished Refresh or Retry already waited for its sources.
    if (this.actionEnded || this.changeStartedAt === null) return true;
    const base = this.changeBase;
    return (
      !base ||
      (advanced(latest.primary.credentialsAt, base.credentialsAt) &&
        advanced(latest.primary.trafficAt, base.trafficAt))
    );
  }

  private flush(): void {
    this.timer = null;
    if (this.actionsRunning > 0) return; // the action's end reschedules
    const held = this.changeStartedAt === null ? 0 : this.timers.now() - this.changeStartedAt;
    if (!this.ready() && held < this.options.maxHoldMs) {
      this.timer = this.timers.set(() => this.flush(), this.options.batchMs);
      return;
    }
    const latest = this.latest;
    const previous = this.announced;
    if (latest) this.announced = latest.snapshot;
    const message = settleAnnouncement(
      latest && previous ? { previous, next: latest.next, text: latest.text } : null,
      this.actionMessages
    );
    this.actionMessages = [];
    this.actionEnded = false;
    this.changeBase = null;
    this.changeStartedAt = null;
    if (message) this.emit(message);
  }
}
