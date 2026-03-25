/**
 * In-memory pending message queue for offline Anthroid clients.
 *
 * Messages are enqueued when the gateway produces output (chat reply, cron run)
 * and drained by the client via `session.drainPending` on
 * reconnect or periodic poll.
 *
 * Best-effort, single-instance only. Drain is destructive (no ack).
 */

export interface PendingMessage {
  content: string;
  sessionKey: string;
  messageId: string;
  enqueuedAt: number;
  source: "chat" | "cron" | "notification";
}

const QUEUES_KEY = Symbol.for("openclaw.pendingQueues");
const globalQueues = globalThis as typeof globalThis & {
  [QUEUES_KEY]?: Map<string, PendingMessage[]>;
};
if (!globalQueues[QUEUES_KEY]) {
  globalQueues[QUEUES_KEY] = new Map();
}
const queues: Map<string, PendingMessage[]> = globalQueues[QUEUES_KEY];

const MAX_PER_KEY = 100;
const MAX_CONTENT_BYTES = 32 * 1024; // 32 KB per message content
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export function enqueuePending(key: string, msg: PendingMessage): void {
  // Skip oversized content to prevent memory bloat
  if (Buffer.byteLength(msg.content, "utf8") > MAX_CONTENT_BYTES) {
    return;
  }
  let queue = queues.get(key);
  if (!queue) {
    queue = [];
    queues.set(key, queue);
  }
  // Prune expired before push so stale items don't evict fresh ones
  const now = Date.now();
  if (queue.length > 0 && now - queue[0].enqueuedAt >= TTL_MS) {
    const filtered = queue.filter((m) => now - m.enqueuedAt < TTL_MS);
    queue.length = 0;
    queue.push(...filtered);
  }
  queue.push(msg);
  // Enforce max size — drop oldest
  while (queue.length > MAX_PER_KEY) {
    queue.shift();
  }
}

export function drainPending(key: string): PendingMessage[] {
  const queue = queues.get(key);
  if (!queue || queue.length === 0) {
    return [];
  }
  queues.delete(key);
  // Filter expired on read for deterministic TTL behavior
  const now = Date.now();
  return queue.filter((m) => now - m.enqueuedAt < TTL_MS);
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [key, queue] of queues) {
    const filtered = queue.filter((m) => now - m.enqueuedAt < TTL_MS);
    if (filtered.length === 0) {
      queues.delete(key);
    } else if (filtered.length !== queue.length) {
      queues.set(key, filtered);
    }
  }
}

const cleanupTimer = setInterval(cleanupExpired, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();
