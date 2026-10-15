import { beforeEach, describe, expect, it } from "vitest";
import { drainPending } from "../../src/gateway/pending-queue.js";
import { anthroidPlugin } from "./api.js";

const sendText = anthroidPlugin.outbound?.sendText;

describe("anthroid outbound", () => {
  beforeEach(() => {
    drainPending("agent:main:cron:job-1");
    drainPending("fallback-target");
    drainPending("user:openclaw-test");
    drainPending("agent:main:main");
  });

  it("queues by session key and preserves the notification title", async () => {
    if (!sendText) {
      throw new Error("anthroid sendText is not configured");
    }

    await sendText({
      cfg: {},
      to: "fallback-target",
      text: "done",
      session: { key: "agent:main:cron:job-1", title: "Cron: Nightly" },
    });

    expect(drainPending("fallback-target")).toEqual([]);
    expect(drainPending("agent:main:cron:job-1")).toEqual([
      expect.objectContaining({
        content: "done",
        title: "Cron: Nightly",
        sessionKey: "agent:main:cron:job-1",
        source: "notification",
      }),
    ]);
  });

  it("falls back to the outbound target when session context is absent", async () => {
    if (!sendText) {
      throw new Error("anthroid sendText is not configured");
    }

    await sendText({ cfg: {}, to: "fallback-target", text: "hello" });

    expect(drainPending("fallback-target")).toEqual([
      expect.objectContaining({
        content: "hello",
        sessionKey: "fallback-target",
        source: "notification",
      }),
    ]);
  });

  it("keys an explicit user: target by the target, not the derived agent session", async () => {
    if (!sendText) {
      throw new Error("anthroid sendText is not configured");
    }

    await sendText({
      cfg: {},
      to: "user:openclaw-test",
      text: "via gateway send",
      session: { key: "agent:main:main" },
    });

    expect(drainPending("agent:main:main")).toEqual([]);
    expect(drainPending("user:openclaw-test")).toEqual([
      expect.objectContaining({ content: "via gateway send", sessionKey: "user:openclaw-test" }),
    ]);
  });

  it("routes an explicit target to the session the app opens for it", async () => {
    const resolve = anthroidPlugin.messaging?.resolveOutboundSessionRoute;
    if (!resolve) {
      throw new Error("anthroid resolveOutboundSessionRoute is not configured");
    }

    const route = await resolve({ cfg: {}, agentId: "main", target: "user:openclaw-test" });
    expect(route).toEqual(
      expect.objectContaining({
        sessionKey: "agent:main:user:openclaw-test",
        baseSessionKey: "agent:main:user:openclaw-test",
        to: "user:openclaw-test",
      }),
    );
    expect(await resolve({ cfg: {}, agentId: "main", target: "Gold Monitor" })).toBeNull();
  });
});
