/**
 * WebSocket client for OpenClaw gateway.
 * Follows the pattern from scripts/dev/gateway-ws-client.ts:
 * lazy connect, auto-reconnect, promise-based RPC with timeout.
 */
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type {
  GatewayReqFrame,
  GatewayResFrame,
  GatewayEventFrame,
  GatewayFrame,
  ChatEventPayload,
  SessionsListResult,
  ChatHistoryResult,
} from "./types.js";

type PendingRequest = {
  resolve: (res: GatewayResFrame) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type EventListener = (evt: GatewayEventFrame) => void;

function toText(data: WebSocket.RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data.map((c) => Buffer.from(c))).toString("utf8");
  }
  return Buffer.from(data as Buffer).toString("utf8");
}

export class OpenClawClient {
  private url: string;
  private token: string;
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventListeners = new Set<EventListener>();
  private connected = false;
  private connecting = false;
  private connectPromise: Promise<void> | null = null;
  private closed = false;
  private backoffMs = 1000;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  /** Ensure connection is established. Lazy — only connects on first call. */
  async ensureConnected(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connecting && this.connectPromise) {
      return this.connectPromise;
    }
    this.connectPromise = this.doConnect();
    return this.connectPromise;
  }

  /** Add an event listener. Returns a removal function. */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Send an RPC request and return the payload. */
  async rpc<T = unknown>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
    await this.ensureConnected();
    const res = await this.sendRequest(method, params, timeoutMs);
    if (!res.ok) {
      const errMsg = res.error?.message ?? JSON.stringify(res.error) ?? "unknown error";
      throw new Error(`RPC ${method} failed: ${errMsg}`);
    }
    return res.payload as T;
  }

  /** Close the client permanently. */
  close() {
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timeout);
      p.reject(new Error("client closed"));
    }
    this.pending.clear();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  // --- High-level RPC methods ---

  async sessionsList(opts?: {
    limit?: number;
    includeLastMessage?: boolean;
    includeDerivedTitles?: boolean;
  }): Promise<SessionsListResult> {
    return this.rpc<SessionsListResult>("sessions.list", {
      limit: opts?.limit,
      includeLastMessage: opts?.includeLastMessage ?? true,
      includeDerivedTitles: opts?.includeDerivedTitles ?? true,
    });
  }

  async chatHistory(sessionKey: string, limit?: number): Promise<ChatHistoryResult> {
    return this.rpc<ChatHistoryResult>("chat.history", {
      sessionKey,
      limit: limit ?? 50,
    });
  }

  /**
   * Send a chat message and collect the full response.
   * Registers event listener BEFORE sending to avoid race conditions.
   */
  async chatSend(
    sessionKey: string,
    message: string,
    timeoutMs = 120_000,
  ): Promise<{ runId: string; response: string; state: string }> {
    await this.ensureConnected();
    const runId = randomUUID();

    return new Promise<{ runId: string; response: string; state: string }>((resolve, reject) => {
      let fullText = "";
      let finalState = "";
      const timer = setTimeout(() => {
        removeListener();
        reject(new Error(`chat.send timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      // Register event listener BEFORE sending to avoid race conditions
      const removeListener = this.onEvent((evt) => {
        if (evt.event !== "chat") {
          return;
        }
        const payload = evt.payload as ChatEventPayload | undefined;
        if (!payload || payload.runId !== runId) {
          return;
        }

        if (payload.state === "delta" && payload.message) {
          // Accumulate text from delta events; use full text from message content
          const text = payload.message.content
            ?.filter((c) => c.type === "text" && c.text)
            .map((c) => c.text)
            .join("");
          if (text) {
            fullText = text;
          }
        } else if (payload.state === "final") {
          // Final may contain the complete message
          if (payload.message) {
            const text = payload.message.content
              ?.filter((c) => c.type === "text" && c.text)
              .map((c) => c.text)
              .join("");
            if (text) {
              fullText = text;
            }
          }
          finalState = "final";
          clearTimeout(timer);
          removeListener();
          resolve({ runId, response: fullText, state: finalState });
        } else if (payload.state === "error") {
          clearTimeout(timer);
          removeListener();
          reject(new Error(payload.errorMessage ?? "chat error"));
        } else if (payload.state === "aborted") {
          clearTimeout(timer);
          removeListener();
          reject(new Error("chat aborted"));
        }
      });

      // Now send the request
      this.rpc("chat.send", {
        sessionKey,
        message,
        idempotencyKey: runId,
      }).catch((err) => {
        clearTimeout(timer);
        removeListener();
        reject(err);
      });
    });
  }

  // --- Internal ---

  private doConnect(): Promise<void> {
    this.connecting = true;
    return new Promise<void>((resolve, reject) => {
      if (this.closed) {
        reject(new Error("client is closed"));
        return;
      }

      const ws = new WebSocket(this.url, {
        handshakeTimeout: 8000,
        maxPayload: 25 * 1024 * 1024,
      });
      this.ws = ws;

      const connectTimeout = setTimeout(() => {
        ws.close();
        reject(new Error("connection timeout"));
      }, 15_000);

      let challengeReceived = false;

      ws.on("open", () => {
        // Wait for connect.challenge event
      });

      ws.on("message", (data) => {
        const text = toText(data);
        let frame: GatewayFrame;
        try {
          frame = JSON.parse(text) as GatewayFrame;
        } catch {
          return;
        }
        if (!frame || typeof frame !== "object" || !("type" in frame)) {
          return;
        }

        if (frame.type === "event") {
          const evt = frame;
          if (evt.event === "connect.challenge" && !challengeReceived) {
            challengeReceived = true;
            const nonce = (evt.payload as { nonce?: string })?.nonce;
            if (!nonce) {
              clearTimeout(connectTimeout);
              reject(new Error("connect challenge missing nonce"));
              return;
            }
            // Send connect request with token auth
            const connectId = randomUUID();
            const connectFrame: GatewayReqFrame = {
              type: "req",
              id: connectId,
              method: "connect",
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: "gateway-client",
                  displayName: "OpenClaw MCP Server",
                  version: "1.0.0",
                  platform: process.platform,
                  mode: "ui",
                  instanceId: randomUUID(),
                },
                role: "operator",
                scopes: ["operator.read", "operator.write", "operator.admin"],
                caps: [],
                auth: { token: this.token },
              },
            };
            // Register pending for connect response
            this.pending.set(connectId, {
              resolve: (res) => {
                if (res.ok) {
                  clearTimeout(connectTimeout);
                  this.connected = true;
                  this.connecting = false;
                  this.backoffMs = 1000;
                  resolve();
                } else {
                  clearTimeout(connectTimeout);
                  reject(
                    new Error(`connect failed: ${res.error?.message ?? JSON.stringify(res.error)}`),
                  );
                }
              },
              reject: (err) => {
                clearTimeout(connectTimeout);
                reject(err);
              },
              timeout: setTimeout(() => {
                this.pending.delete(connectId);
                clearTimeout(connectTimeout);
                reject(new Error("connect response timeout"));
              }, 10_000),
            });
            ws.send(JSON.stringify(connectFrame));
            return;
          }
          // Dispatch to event listeners after connected
          if (this.connected) {
            for (const listener of this.eventListeners) {
              try {
                listener(evt);
              } catch {
                // ignore listener errors
              }
            }
          }
          return;
        }

        if (frame.type === "res") {
          const res = frame;
          const waiter = this.pending.get(res.id);
          if (waiter) {
            this.pending.delete(res.id);
            clearTimeout(waiter.timeout);
            waiter.resolve(res);
          }
        }
      });

      ws.on("close", (_code, _reason) => {
        this.connected = false;
        this.connecting = false;
        this.flushPendingErrors("connection closed");
        if (!this.closed) {
          this.scheduleReconnect();
        }
      });

      ws.on("error", (err) => {
        if (!this.connected && !challengeReceived) {
          clearTimeout(connectTimeout);
          this.connecting = false;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  private sendRequest(
    method: string,
    params?: unknown,
    timeoutMs = 30_000,
  ): Promise<GatewayResFrame> {
    return new Promise<GatewayResFrame>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("not connected"));
        return;
      }
      const id = randomUUID();
      const frame: GatewayReqFrame = { type: "req", id, method, params };
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC ${method} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify(frame));
    });
  }

  private flushPendingErrors(reason: string) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timeout);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private scheduleReconnect() {
    if (this.closed) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    setTimeout(() => {
      if (!this.closed) {
        this.connectPromise = this.doConnect().catch(() => {
          // reconnect silently; will retry
        });
      }
    }, delay);
  }
}
