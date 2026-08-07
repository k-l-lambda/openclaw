import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
// session.drainPending + session.drainAllPending RPC handlers.
// Backed by the in-memory pending-queue (../pending-queue.js). Clients
// (Anthroid) call drainPending with their session key on reconnect/periodic
// poll to pull offline-buffered messages; drainAllPending is the operator
// admin variant. Re-ported during the 0724-25 upstream rebase onto the
// per-handler-module structure.
import { drainAll, drainPending } from "../pending-queue.js";
import type { GatewayRequestHandlers } from "./types.js";

export const sessionDrainHandlers: GatewayRequestHandlers = {
  "session.drainPending": async ({ params, respond }) => {
    const p = params && typeof params === "object" ? params : {};
    const key =
      typeof (p as { key?: unknown }).key === "string" ? (p as { key: string }).key.trim() : "";
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key is required"));
      return;
    }
    const messages = drainPending(key);
    respond(true, {
      messages: messages.map((m) => ({
        content: m.content,
        title: m.title,
        messageId: m.messageId,
        source: m.source,
        enqueuedAt: m.enqueuedAt,
      })),
    });
  },

  "session.drainAllPending": async ({ respond }) => {
    const messages = drainAll();
    respond(true, {
      messages: messages.map((m) => ({
        sessionKey: m.sessionKey,
        content: m.content,
        title: m.title,
        messageId: m.messageId,
        source: m.source,
        enqueuedAt: m.enqueuedAt,
      })),
    });
  },
};
