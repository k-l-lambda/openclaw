/** WebSocket protocol frame types for OpenClaw gateway communication. */

export type GatewayReqFrame = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

export type GatewayResFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message?: string; [key: string]: unknown };
};

export type GatewayEventFrame = {
  type: "event";
  event: string;
  seq?: number;
  payload?: unknown;
};

export type GatewayFrame = GatewayReqFrame | GatewayResFrame | GatewayEventFrame;

/** Chat event payload emitted as `event.chat`. */
export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  seq: number;
  state: "delta" | "final" | "aborted" | "error";
  message?: {
    role: string;
    content: Array<{ type: string; text?: string }>;
    timestamp?: number;
  };
  errorMessage?: string;
  stopReason?: string;
};

/** Session entry returned by `sessions.list`. */
export type SessionEntry = {
  key: string;
  sessionId?: string;
  displayName?: string;
  model?: string;
  modelProvider?: string;
  updatedAt?: number | null;
  label?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
};

/** Result of `sessions.list` RPC. */
export type SessionsListResult = {
  ts: number;
  path: string;
  count: number;
  sessions: SessionEntry[];
};

/** Result of `chat.history` RPC. */
export type ChatHistoryResult = {
  sessionKey: string;
  messages: Array<{
    role: string;
    content: unknown;
    timestamp?: number;
  }>;
};
