/**
 * Simple concurrency limiter for async operations (p-limit style).
 * Ensures at most `concurrency` tasks run simultaneously.
 */
export class ConcurrencyLimiter {
  private readonly concurrency: number;
  private running = 0;
  private pending: Array<() => void> = [];

  constructor(concurrency: number) {
    if (concurrency < 1) {
      throw new Error('Concurrency must be at least 1');
    }
    this.concurrency = concurrency;
  }

  /**
   * Enqueue an async function to run with concurrency control.
   * Returns a promise that resolves/rejects with the task result.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for a free slot
    while (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => this.pending.push(resolve));
    }

    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      // Release next pending task if any
      const next = this.pending.shift();
      if (next) next();
    }
  }

  /**
   * Wait for all running tasks to complete.
   * Does not prevent new tasks from being enqueued.
   */
  async drain(): Promise<void> {
    while (this.running > 0) {
      await new Promise<void>((resolve) => this.pending.push(resolve));
    }
  }

  /**
   * Get current number of running tasks.
   */
  getRunning(): number {
    return this.running;
  }

  /**
   * Get current number of pending tasks waiting for slots.
   */
  getPending(): number {
    return this.pending.length;
  }
}
