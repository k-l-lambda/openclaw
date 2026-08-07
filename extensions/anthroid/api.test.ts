import { beforeEach, describe, expect, it } from "vitest";
import { drainPending } from "../../src/gateway/pending-queue.js";
import { anthroidPlugin } from "./api.js";

const sendText = anthroidPlugin.outbound?.sendText;

describe("anthroid outbound", () => {
  beforeEach(() => {
    drainPending("agent:main:cron:job-1");
    drainPending("fallback-target");
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
});
