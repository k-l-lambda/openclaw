import { drainPending } from "../pending-queue.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
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
      messages: messages.map((m) => ({ content: m.content })),
    });
  },
};
