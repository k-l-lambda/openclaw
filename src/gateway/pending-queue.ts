/**
 * In-memory pending message queue for offline Anthroid clients.
 *
 * Messages are enqueued when the gateway produces output (chat reply, cron run,
 * notification) and drained by the client via `session.drainPending` on
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

const queues = new Map<string, PendingMessage[]>();

const MAX_PER_KEY = 100;
const MAX_CONTENT_BYTES = 32 * 1024; // 32 KB per message content
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export function enqueuePending(key: string, msg: PendingMessage): void {
  // Skip oversized content to prevent memory bloat
  if (msg.content.length > MAX_CONTENT_BYTES) {
    return;
  }
  let queue = queues.get(key);
  if (!queue) {
    queue = [];
    queues.set(key, queue);
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
