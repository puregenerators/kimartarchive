/**
 * Small concurrent job queue for TIFF UI preview generation.
 * Failed jobs do not block the rest of the queue.
 */

export type PreviewQueueJob<T> = {
  id: string;
  payload: T;
};

export type PreviewQueueOptions<T> = {
  concurrency: number;
  run: (job: PreviewQueueJob<T>) => Promise<void>;
};

export type PreviewQueue<T> = {
  enqueue: (job: PreviewQueueJob<T>) => void;
  /** Remove queued jobs for an id; in-flight jobs finish but callers should ignore stale results. */
  cancel: (id: string) => void;
  clear: () => void;
  /** Test helper: how many jobs are actively running. */
  activeCount: () => number;
  /** Test helper: how many jobs are waiting. */
  queuedCount: () => number;
};

export function createPreviewQueue<T>(
  options: PreviewQueueOptions<T>,
): PreviewQueue<T> {
  const concurrency = Math.max(1, options.concurrency);
  const pending: PreviewQueueJob<T>[] = [];
  const activeIds = new Set<string>();
  let running = 0;

  function pump() {
    while (running < concurrency && pending.length > 0) {
      const job = pending.shift()!;
      running += 1;
      activeIds.add(job.id);
      void options
        .run(job)
        .catch(() => {
          // Caller records failure; queue continues.
        })
        .finally(() => {
          running -= 1;
          activeIds.delete(job.id);
          pump();
        });
    }
  }

  return {
    enqueue(job) {
      // Replace any existing queued job for the same id.
      const existingIndex = pending.findIndex((item) => item.id === job.id);
      if (existingIndex >= 0) {
        pending.splice(existingIndex, 1);
      }
      pending.push(job);
      pump();
    },
    cancel(id) {
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        if (pending[i].id === id) pending.splice(i, 1);
      }
    },
    clear() {
      pending.length = 0;
    },
    activeCount: () => running,
    queuedCount: () => pending.length,
  };
}
