export class SingleFlightPoll {
  private running = false
  private rerunRequested = false
  private stopped = false
  private readonly task: () => Promise<void>
  private readonly scheduleNext: (run: () => void) => void

  constructor(
    task: () => Promise<void>,
    scheduleNext: (run: () => void) => void,
  ) {
    this.task = task
    this.scheduleNext = scheduleNext
  }

  trigger(): void {
    if (this.stopped) return
    if (this.running) {
      this.rerunRequested = true
      return
    }

    this.running = true
    void this.drain()
  }

  stop(): void {
    this.stopped = true
    this.rerunRequested = false
  }

  private async drain(): Promise<void> {
    try {
      do {
        this.rerunRequested = false
        await this.task()
      } while (!this.stopped && this.rerunRequested)
    } finally {
      this.running = false
      if (!this.stopped) {
        this.scheduleNext(() => this.trigger())
      }
    }
  }
}
