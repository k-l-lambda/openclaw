import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const TITLE_MAX_LEN = 200;
const BODY_MAX_LEN = 4000;

export const notificationHandlers: GatewayRequestHandlers = {
  "notification.push": async ({ params, respond, context }) => {
    const p = params && typeof params === "object" ? params : {};
    const title =
      typeof (p as { title?: unknown }).title === "string" && (p as { title: string }).title.trim()
        ? (p as { title: string }).title.trim().slice(0, TITLE_MAX_LEN)
        : "OpenClaw";
    const bodyRaw =
      typeof (p as { body?: unknown }).body === "string" ? (p as { body: string }).body.trim() : "";
    if (!bodyRaw) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "body is required"));
      return;
    }
    const body = bodyRaw.slice(0, BODY_MAX_LEN);
    context.broadcast("notification.push", { title, body });
    respond(true, { ok: true, title, body });
  },
};
