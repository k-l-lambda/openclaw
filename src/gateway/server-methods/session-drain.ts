import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
// session.drainPending + session.drainAllPending + session.peekPending RPC handlers.
// Backed by the in-memory pending-queue (../pending-queue.js). Clients
// (Anthroid) call drainPending with their session key on reconnect/periodic
// poll to pull offline-buffered messages; drainAllPending is the operator
// admin variant. Re-ported during the 0724-25 upstream rebase onto the
// per-handler-module structure. peekPending is the non-destructive operator
// view; drains that return messages are logged because a destructive read with
// no ack is otherwise invisible when the client drops what it received.
import { drainAll, drainPending, peekPending, type PendingMessage } from "../pending-queue.js";
import type {
  GatewayRequestContext,
  GatewayRequestHandlerOptions,
  GatewayRequestHandlers,
} from "./types.js";

type DrainClient = GatewayRequestHandlerOptions["client"];

function logDrain(
  context: GatewayRequestContext,
  client: DrainClient,
  method: string,
  messages: PendingMessage[],
): void {
  if (messages.length === 0) {
    return;
  }
  const keys = [...new Set(messages.map((m) => m.sessionKey))].join(",");
  const clientId = client?.connect?.client?.id ?? "unknown";
  context.logGateway.info(
    `${method} returned ${messages.length} message(s) keys=${keys} client=${clientId} conn=${client?.connId ?? "?"}`,
  );
}

export const sessionDrainHandlers: GatewayRequestHandlers = {
  "session.drainPending": async ({ params, respond, context, client }) => {
    const p = params && typeof params === "object" ? params : {};
    const key =
      typeof (p as { key?: unknown }).key === "string" ? (p as { key: string }).key.trim() : "";
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key is required"));
      return;
    }
    const messages = drainPending(key);
    logDrain(context, client, "session.drainPending", messages);
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

  "session.drainAllPending": async ({ respond, context, client }) => {
    const messages = drainAll();
    logDrain(context, client, "session.drainAllPending", messages);
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

  "session.peekPending": async ({ params, respond }) => {
    const p = params && typeof params === "object" ? params : {};
    const rawKey = (p as { key?: unknown }).key;
    const key = typeof rawKey === "string" && rawKey.trim() ? rawKey.trim() : undefined;
    const messages = peekPending(key);
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
