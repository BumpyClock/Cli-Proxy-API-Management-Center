import {
  escalates,
  escalationSnapshot,
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
 * state first differs from the announced one, the change is held:
 * - until both sources have reported after the change began (a report from before it
 *   does not count); once they have, a newer poll in flight does not hold it again;
 * - while a source is still owed a report, through any request in flight (its answer or
 *   timeout settles the headline), otherwise for at most `maxHoldMs` after the change,
 *   never after an unchanged poll. If that limit forces an announcement, the sources
 *   still owed a report stay owed, so their answer is announced at once.
 * New or worse issues skip the hold, but any recovery in the same update stays pending
 * in the existing comparison baseline. Operators hear the urgent issues without a
 * provisional recovery or headline. Once sources catch up, the net remaining change is
 * announced. Refresh and Retry hold
 * announcements until they end; then their result leads.
 */
export class LiveAnnouncer {
  private announced: AnnouncementSnapshot | null = null;
  private latest: AnnouncerUpdate | null = null;
  private lastMarks: Marks | null = null;
  /** Receipt marks just before the pending change was first seen. */
  private changeBase: Marks | null = null;
  /** Marks still owed a report after a forced announcement; the next change starts here. */
  private carriedBase: Marks | null = null;
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
      if (this.carriedBase && this.caughtUp(this.carriedBase)) this.carriedBase = null;
      if (this.actionEnded) this.schedule();
      return;
    }
    if (this.changeStartedAt === null) {
      this.changeStartedAt = this.timers.now();
      this.changeBase = this.carriedBase ??
        previousMarks ?? { credentialsAt: null, trafficAt: null };
      this.carriedBase = null;
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

  private caughtUp(base: Marks): boolean {
    const latest = this.latest;
    return (
      !!latest &&
      advanced(latest.primary.credentialsAt, base.credentialsAt) &&
      advanced(latest.primary.trafficAt, base.trafficAt)
    );
  }

  private flush(): void {
    this.timer = null;
    const latest = this.latest;
    // The action's end reschedules.
    if (this.actionsRunning > 0) return;
    // A finished Refresh or Retry already waited for its sources.
    const base = this.actionEnded || this.changeStartedAt === null ? null : this.changeBase;
    // New or worse issues are spoken at once; a recovery waits for both sources.
    const urgent = !!latest && !!this.announced && escalates(this.announced, latest.snapshot);
    const ready = !base || this.caughtUp(base);
    if (!ready && urgent && latest && this.announced) {
      const snapshot = escalationSnapshot(this.announced, latest.snapshot);
      const message = settleAnnouncement(
        { previous: this.announced, next: latest.next, text: latest.text, snapshot },
        []
      );
      this.announced = snapshot;
      if (message) this.emit(message);
      if (!sameAnnouncementState(snapshot, latest.snapshot)) {
        this.schedule();
      } else {
        this.carriedBase = base;
        this.changeBase = null;
        this.changeStartedAt = null;
      }
      return;
    }
    if (!ready) {
      const held = this.changeStartedAt === null ? 0 : this.timers.now() - this.changeStartedAt;
      // A source is still owed a report: wait while a request is in flight (its answer or
      // timeout settles the headline), otherwise up to the limit. Once both have reported,
      // a newer poll in flight does not hold the announcement again.
      if (latest?.primary.busy || held < this.options.maxHoldMs) {
        this.timer = this.timers.set(() => this.flush(), this.options.batchMs);
        return;
      }
    }
    // Forced by the limit: the sources still owed a report stay owed for the next change.
    this.carriedBase = ready ? null : base;
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
