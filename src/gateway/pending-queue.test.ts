import { beforeEach, describe, expect, it } from "vitest";
import { drainAll, enqueuePending, peekPending } from "./pending-queue.js";

function msg(sessionKey: string, content: string) {
  return {
    content,
    sessionKey,
    messageId: `${sessionKey}:${content}`,
    enqueuedAt: Date.now(),
    source: "notification" as const,
  };
}

describe("pending-queue peekPending", () => {
  beforeEach(() => {
    drainAll();
  });

  it("returns queued messages without consuming them", () => {
    enqueuePending("user:a", msg("user:a", "one"));
    enqueuePending("user:b", msg("user:b", "two"));

    expect(peekPending("user:a").map((m) => m.content)).toEqual(["one"]);
    expect(peekPending().map((m) => m.content)).toEqual(["one", "two"]);
    expect(drainAll().map((m) => m.content)).toEqual(["one", "two"]);
    expect(peekPending()).toEqual([]);
  });

  it("returns an empty list for an unknown key", () => {
    expect(peekPending("user:missing")).toEqual([]);
  });

  it("omits expired messages", () => {
    enqueuePending("user:a", { ...msg("user:a", "old"), enqueuedAt: Date.now() - 25 * 3600_000 });
    expect(peekPending("user:a")).toEqual([]);
  });
});
