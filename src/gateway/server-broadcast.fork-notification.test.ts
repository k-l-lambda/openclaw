// Fork: notification.push is a fork-added gateway method (core-descriptors.fork.ts).
// A broadcast event with no EVENT_SCOPE_GUARDS entry hits the default
// `if (!required) return false` and is dropped for every client, so the RPC
// answers ok while delivering nothing. These tests fail if that entry is lost
// in an upstream rebase.
import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createGatewayBroadcaster } from "./server-broadcast.js";
import { GatewayClientRegistry } from "./server/client-registry.js";
import type { GatewayWsClient } from "./server/ws-types.js";

type RecordingSocket = {
  readyState: number;
  bufferedAmount: number;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  events: string[];
};

function makeClient(
  connId: string,
  role: "node" | "operator",
  scopes: string[],
): { client: GatewayWsClient; socket: RecordingSocket } {
  const events: string[] = [];
  const socket: RecordingSocket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    close: vi.fn(),
    send: vi.fn((payload: string) => {
      events.push((JSON.parse(payload) as { event: string }).event);
    }),
    events,
  };
  return {
    client: {
      socket: socket as unknown as GatewayWsClient["socket"],
      connect: { role, scopes } as GatewayWsClient["connect"],
      connId,
      usesSharedGatewayAuth: false,
    },
    socket,
  };
}

describe("fork notification.push event scope guard", () => {
  it("delivers notification.push to write-capable operators", () => {
    const write = makeClient("write", "operator", ["operator.write"]);
    const admin = makeClient("admin", "operator", ["operator.admin"]);
    // Anthroid connects with exactly read+write (GatewayManager.kt DEFAULT_SCOPES).
    const anthroid = makeClient("anthroid", "operator", ["operator.read", "operator.write"]);
    const { broadcast } = createGatewayBroadcaster({
      clients: new GatewayClientRegistry([write.client, admin.client, anthroid.client]),
    });

    broadcast("notification.push", { title: "OpenClaw", body: "hello" });

    expect(write.socket.events).toEqual(["notification.push"]);
    expect(admin.socket.events).toEqual(["notification.push"]);
    expect(anthroid.socket.events).toEqual(["notification.push"]);
  });

  it("withholds notification.push from read-only, pairing, and node clients", () => {
    const read = makeClient("read", "operator", ["operator.read"]);
    const pairing = makeClient("pairing", "operator", ["operator.pairing"]);
    const node = makeClient("node", "node", ["operator.write"]);
    const { broadcast } = createGatewayBroadcaster({
      clients: new GatewayClientRegistry([read.client, pairing.client, node.client]),
    });

    broadcast("notification.push", { title: "OpenClaw", body: "hello" });

    expect(read.socket.events).toEqual([]);
    expect(pairing.socket.events).toEqual([]);
    expect(node.socket.events).toEqual([]);
  });
});

describe("fork question event reachability for anthroid scopes", () => {
  it("requires operator.questions: read+write alone receives nothing", () => {
    // Regression guard for GatewayManager.kt DEFAULT_SCOPES. Anthroid must request
    // operator.questions or the phone is filtered out of every question event.
    const readWrite = makeClient("rw", "operator", ["operator.read", "operator.write"]);
    const questions = makeClient("q", "operator", [
      "operator.read",
      "operator.write",
      "operator.questions",
    ]);
    const { broadcast } = createGatewayBroadcaster({
      clients: new GatewayClientRegistry([readWrite.client, questions.client]),
    });

    broadcast("question.requested", {
      id: "question-1",
      questions: [],
      createdAtMs: 1,
      expiresAtMs: 2,
      status: "pending",
    });
    broadcast("question.resolved", { id: "question-1", status: "expired" });

    expect(readWrite.socket.events).toEqual([]);
    expect(questions.socket.events).toEqual(["question.requested", "question.resolved"]);
  });
});
