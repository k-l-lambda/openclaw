#!/usr/bin/env node
// openclaw MCP server — gateway client tools

import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import WebSocket from "ws";
import { z } from "zod";

const PROTOCOL_VERSION = 3;
const CLIENT_ID = "gateway-client";
const CLIENT_MODE = "backend";
const CLIENT_VERSION = "mcp-server/1.0";

const GATEWAY_URL = process.env.OPENCLAW_URL || "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = process.env.OPENCLAW_TOKEN || "";

// ─── Gateway WebSocket Client ─────────────────────────────────────────────────

type PendingEntry = {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
};

type EventHandler = (msg: Record<string, unknown>) => void;

class GatewayClient {
  private url: string;
  private token: string;
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingEntry>();
  private _eventHandlers?: Set<EventHandler>;
  ready = false;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  connect(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      const timeout = setTimeout(() => {
        reject(new Error("gateway connect timeout"));
        ws.terminate();
      }, 10000);

      ws.on("error", (err: Error) => {
        clearTimeout(timeout);
        if (!this.ready) {
          reject(err);
        }
      });

      ws.on("message", (raw: Buffer) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        } catch {
          return;
        }

        // Server sends connect.challenge event first
        if (msg["type"] === "event" && msg["event"] === "connect.challenge") {
          const payload = msg["payload"] as Record<string, unknown> | undefined;
          const nonce = payload?.["nonce"];
          if (!nonce) {
            clearTimeout(timeout);
            reject(new Error("missing nonce in connect.challenge"));
            ws.close();
            return;
          }
          const connectParams = {
            minProtocol: PROTOCOL_VERSION,
            maxProtocol: PROTOCOL_VERSION,
            client: {
              id: CLIENT_ID,
              displayName: "Claude Code MCP",
              version: CLIENT_VERSION,
              platform: process.platform,
              mode: CLIENT_MODE,
            },
            caps: [],
            role: "operator",
            scopes: ["operator.admin"],
            auth: this.token ? { token: this.token } : undefined,
          };
          const reqId = randomUUID();
          this._send({ type: "req", id: reqId, method: "connect", params: connectParams });
          this.pending.set(reqId, {
            resolve: (p) => {
              clearTimeout(timeout);
              this.ready = true;
              resolve(p);
            },
            reject: (err) => {
              clearTimeout(timeout);
              reject(err);
            },
          });
          return;
        }

        if (msg["type"] === "res") {
          const p = this.pending.get(msg["id"] as string);
          if (!p) {
            return;
          }
          this.pending.delete(msg["id"] as string);
          if (msg["ok"]) {
            p.resolve(msg["payload"]);
          } else {
            const error = msg["error"] as Record<string, unknown> | undefined;
            p.reject(new Error((error?.["message"] as string) || "gateway error"));
          }
          return;
        }

        // Dispatch to event handlers (e.g. chat events)
        if (msg["type"] === "event" && this._eventHandlers?.size) {
          for (const h of this._eventHandlers) {
            try {
              h(msg);
            } catch {}
          }
        }
      });

      ws.on("close", () => {
        if (!this.ready) {
          clearTimeout(timeout);
          reject(new Error("gateway connection closed before ready"));
        }
        for (const [, p] of this.pending) {
          p.reject(new Error("gateway disconnected"));
        }
        this.pending.clear();
        this.ready = false;
      });
    });
  }

  private _send(frame: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  request(method: string, params: unknown, timeoutMs = 30000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`gateway request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (p) => {
          clearTimeout(timer);
          resolve(p);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this._send({ type: "req", id, method, params });
    });
  }

  // Register a one-shot event listener; returns unsubscribe fn
  onEvent(handler: EventHandler): () => void {
    if (!this._eventHandlers) {
      this._eventHandlers = new Set();
    }
    this._eventHandlers.add(handler);
    return () => this._eventHandlers?.delete(handler);
  }

  // Wait for a chat.final event for a specific sessionKey
  waitForChatFinal(sessionKey: string, timeoutMs = 60000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`chat final timeout for ${sessionKey}`));
      }, timeoutMs);

      const off = this.onEvent((msg) => {
        if (msg["type"] !== "event" || msg["event"] !== "chat") {
          return;
        }
        const p = msg["payload"] as Record<string, unknown> | undefined;
        if (!p || p["sessionKey"] !== sessionKey) {
          return;
        }
        if (p["state"] === "final" || p["state"] === "aborted" || p["state"] === "error") {
          clearTimeout(timer);
          off();
          if (p["state"] === "error") {
            reject(new Error((p["errorMessage"] as string) || "chat error"));
          } else {
            resolve(p);
          }
        }
      });
    });
  }

  close() {
    this.ws?.close();
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _client: GatewayClient | null = null;

async function getClient(): Promise<GatewayClient> {
  if (_client?.ready) {
    return _client;
  }
  _client = new GatewayClient(GATEWAY_URL, GATEWAY_TOKEN);
  await _client.connect();
  return _client;
}

async function call(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
  try {
    const c = await getClient();
    return await c.request(method, params, timeoutMs);
  } catch (err) {
    _client = null;
    throw err;
  }
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({ name: "openclaw", version: "1.0.0" });

server.tool(
  "openclaw_sessions_list",
  "List active openclaw agent sessions",
  {
    kinds: z
      .array(z.string())
      .optional()
      .describe("Filter by kind: main, group, cron, hook, node, other"),
    limit: z.number().optional().describe("Max rows (default 50)"),
    activeMinutes: z.number().optional().describe("Only sessions updated within N minutes"),
  },
  async (params) => {
    const result = await call("sessions.list", {
      kinds: params.kinds,
      limit: params.limit ?? 50,
      activeMinutes: params.activeMinutes,
    });
    const sessions = Array.isArray(result)
      ? result
      : ((result as Record<string, unknown>)?.["sessions"] ?? []);
    const lines = (sessions as Record<string, unknown>[]).map(
      (s) =>
        `${(s["key"] as string) || "?"} | ${(s["channel"] as string) || "?"} | ${(s["kind"] as string) || "?"} | ${((s["model"] as string) || "?").slice(0, 40)}`,
    );
    return { content: [{ type: "text" as const, text: lines.join("\n") || "(no sessions)" }] };
  },
);

server.tool(
  "openclaw_chat_send",
  "Send a message to an openclaw agent session and wait for the reply",
  {
    sessionKey: z.string().describe("Session key, e.g. agent:main:main"),
    message: z.string().describe("Message to send"),
    timeoutMs: z.number().optional().describe("Wait timeout in ms (default 120000)"),
  },
  async (params) => {
    const timeout = params.timeoutMs ?? 120000;
    const client = await getClient();

    // Register event listener BEFORE sending to avoid race condition
    const finalEventPromise = client.waitForChatFinal(params.sessionKey, timeout);

    // Send the message
    await client.request(
      "chat.send",
      {
        sessionKey: params.sessionKey,
        message: params.message,
        idempotencyKey: randomUUID(),
      },
      10000,
    );

    // Wait for final event
    const finalEvent = await finalEventPromise;

    // Extract text from final message
    const msg = finalEvent?.["message"] as Record<string, unknown> | undefined;
    let text = "";
    if (msg) {
      const content = msg["content"];
      if (Array.isArray(content)) {
        text = (content as Record<string, unknown>[])
          .filter((b) => b["type"] === "text")
          .map((b) => (b["text"] as string) || "")
          .join("");
      } else if (typeof content === "string") {
        text = content;
      } else if (typeof msg["text"] === "string") {
        text = msg["text"];
      }
    }
    return { content: [{ type: "text" as const, text: text || "(no reply text)" }] };
  },
);

server.tool(
  "openclaw_chat_history",
  "Get recent chat history for an openclaw session",
  {
    sessionKey: z.string().describe("Session key, e.g. agent:main:main"),
    limit: z.number().optional().describe("Max messages (default 20)"),
  },
  async (params) => {
    const result = await call("chat.history", {
      sessionKey: params.sessionKey,
      limit: params.limit ?? 20,
    });
    const messages = Array.isArray(result)
      ? result
      : ((result as Record<string, unknown>)?.["messages"] ??
        (result as Record<string, unknown>)?.["history"] ??
        []);
    if (!(messages as unknown[]).length) {
      return { content: [{ type: "text" as const, text: "(no messages)" }] };
    }
    const lines = (messages as Record<string, unknown>[]).map((m) => {
      const role = (m["role"] as string) || "?";
      const text = (() => {
        if (typeof m["content"] === "string") {
          return m["content"];
        }
        if (Array.isArray(m["content"])) {
          return (m["content"] as Record<string, unknown>[])
            .map((b) => (b["text"] as string) || "")
            .join(" ");
        }
        return JSON.stringify(m["content"] ?? m);
      })();
      return `[${role}] ${text.slice(0, 300)}`;
    });
    return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
  },
);

// ─── Start ────────────────────────────────────────────────────────────────────

try {
  await getClient();
} catch (err) {
  process.stderr.write(`openclaw mcp: gateway pre-connect failed: ${(err as Error).message}\n`);
}

const transport = new StdioServerTransport();
await server.connect(transport);
