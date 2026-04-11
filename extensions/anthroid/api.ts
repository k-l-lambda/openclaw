/**
 * Anthroid channel plugin — enqueues outbound messages into the pending queue
 * so that Anthroid clients receive them via `drainPending` on reconnect/poll.
 */

import crypto from "node:crypto";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";

type AnthroidAccount = { enabled: true };

// Access the shared pending queue via global symbol (same key as pending-queue.ts).
const QUEUES_KEY = Symbol.for("openclaw.pendingQueues");
const MAX_PER_KEY = 100;

interface PendingMessage {
  content: string;
  sessionKey: string;
  messageId: string;
  enqueuedAt: number;
  source: "chat" | "cron" | "notification";
}

function enqueuePending(key: string, msg: PendingMessage): void {
  const g = globalThis as Record<symbol, Map<string, PendingMessage[]> | undefined>;
  if (!g[QUEUES_KEY]) {
    g[QUEUES_KEY] = new Map();
  }
  const queues = g[QUEUES_KEY];
  let queue = queues.get(key);
  if (!queue) {
    queue = [];
    queues.set(key, queue);
  }
  queue.push(msg);
  while (queue.length > MAX_PER_KEY) {
    queue.shift();
  }
}

export const anthroidPlugin: ChannelPlugin<AnthroidAccount> = {
  id: "anthroid",
  meta: {
    id: "anthroid",
    label: "Anthroid",
    selectionLabel: "Anthroid",
    docsPath: "",
    blurb: "In-memory pending queue for Anthroid mobile clients.",
  },
  capabilities: {
    chatTypes: ["direct"],
  },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({ enabled: true }),
  },
  messaging: {
    targetResolver: {
      looksLikeId: () => true,
      async resolveTarget({ input }) {
        return { to: input, kind: "user" as const, source: "normalized" as const };
      },
    },
  },
  outbound: {
    deliveryMode: "direct",
    resolveTarget({ to }) {
      if (!to) {
        return { ok: false, error: new Error("missing target session key") };
      }
      return { ok: true, to };
    },
    async sendText(ctx) {
      const sessionKey = ctx.to;
      const messageId = ctx.dedupeKey ?? crypto.randomUUID();
      enqueuePending(sessionKey, {
        content: ctx.text,
        sessionKey,
        messageId,
        enqueuedAt: Date.now(),
        source: "notification",
      });
      return {
        channel: "anthroid",
        messageId,
      };
    },
  },
};
