/**
 * In-process async mutex for inventory ID allocation.
 *
 * This only serializes concurrent submissions inside ONE Node process.
 * It does NOT protect against two computers, two `next dev` instances,
 * or multiple server replicas allocating IDs at the same time.
 * Google Sheets does not provide database-grade locking.
 */

type Waiter = {
  resolve: () => void;
};

export class AsyncMutex {
  private locked = false;
  private readonly queue: Waiter[] = [];

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }

    await new Promise<void>((resolve) => {
      this.queue.push({ resolve });
    });
    this.locked = true;
    return () => this.release();
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next.resolve();
      return;
    }
    this.locked = false;
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Shared mutex for inventory claim allocation in this process. */
export const inventoryAllocationMutex = new AsyncMutex();
