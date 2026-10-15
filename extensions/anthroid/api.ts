/**
 * Anthroid channel plugin — enqueues outbound messages into the pending queue
 * so that Anthroid clients receive them via `session.drainPending` on reconnect/poll.
 */

import crypto from "node:crypto";
import { enqueuePending } from "openclaw/plugin-sdk/channel-outbound";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";

type AnthroidAccount = { enabled: true };

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
  outbound: {
    // "gateway": out-of-process callers (CLI `message send`, MCP) route through the
    // gateway `send` RPC, so enqueuePending() runs in the gateway process that owns
    // the in-memory pending queue. "direct" enqueued into the caller's own process,
    // and the message vanished when the CLI exited.
    deliveryMode: "gateway",
    resolveTarget({ to }) {
      if (!to) {
        return { ok: false, error: new Error("missing target session key") };
      }
      return { ok: true, to };
    },
    async sendText(ctx) {
      const sessionKey = ctx.session?.key ?? ctx.to;
      const messageId = crypto.randomUUID();
      enqueuePending(sessionKey, {
        content: ctx.text,
        title: ctx.session?.title,
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
