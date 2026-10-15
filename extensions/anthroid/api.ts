/**
 * Anthroid channel plugin — enqueues outbound messages into the pending queue
 * so that Anthroid clients receive them via `session.drainPending` on reconnect/poll.
 */

import crypto from "node:crypto";
import { enqueuePending } from "openclaw/plugin-sdk/channel-outbound";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { normalizeAgentId } from "openclaw/plugin-sdk/routing";

type AnthroidAccount = { enabled: true };

// An explicit `user:`/`channel:` target names the Anthroid conversation the
// sender asked for. The gateway `send` RPC derives a generic agent session
// (e.g. `agent:main:main`) for such targets, which would fold every CLI send
// into the main chat. Cron announces pass a display title as `to` and rely on
// their run session key, so only addressable targets override the session.
const EXPLICIT_TARGET = /^(user|channel):\S/;

function resolveQueueKey(to: string, sessionKey: string | undefined): string {
  if (EXPLICIT_TARGET.test(to)) {
    return to;
  }
  return sessionKey ?? to;
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
    // The app opens a `user:x` conversation as session `agent:<id>:user:x`
    // (chat.send canonicalizes the bare key). Route the outbound mirror there
    // too, so the queued message and the user's reply share one transcript
    // instead of the mirror landing in `agent:<id>:main`. Other targets
    // (cron display titles) keep the core fallback.
    resolveOutboundSessionRoute: ({ agentId, target }) => {
      const to = target.trim();
      if (!EXPLICIT_TARGET.test(to)) {
        return null;
      }
      const sessionKey = `agent:${normalizeAgentId(agentId)}:${to}`;
      return {
        sessionKey,
        baseSessionKey: sessionKey,
        peer: { kind: "direct", id: to },
        chatType: "direct",
        from: "anthroid:default",
        to,
      };
    },
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
      const sessionKey = resolveQueueKey(ctx.to, ctx.session?.key);
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
