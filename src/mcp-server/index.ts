#!/usr/bin/env node
/**
 * OpenClaw MCP Server — bridges Claude Code to OpenClaw gateway via WebSocket.
 *
 * Tools:
 *   openclaw_sessions_list  — list sessions with metadata
 *   openclaw_chat_send      — send message, block until full response
 *   openclaw_chat_history   — get recent chat history
 *
 * Env:
 *   OPENCLAW_URL   — WebSocket URL (default: ws://127.0.0.1:18789)
 *   OPENCLAW_TOKEN — auth token (required)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { OpenClawClient } from "./openclaw-client.js";

const OPENCLAW_URL = process.env.OPENCLAW_URL ?? "ws://127.0.0.1:18789";
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN ?? "";

if (!OPENCLAW_TOKEN) {
  process.stderr.write("ERROR: OPENCLAW_TOKEN env var is required\n");
  process.exit(1);
}

const client = new OpenClawClient(OPENCLAW_URL, OPENCLAW_TOKEN);

const server = new McpServer({
  name: "openclaw",
  version: "1.0.0",
});

// --- Tool: openclaw_sessions_list ---
server.tool(
  "openclaw_sessions_list",
  "List OpenClaw sessions with metadata (key, displayName, model, lastMessage, etc.)",
  {
    limit: z.number().int().min(1).max(100).optional().describe("Max number of sessions to return"),
  },
  async ({ limit }) => {
    try {
      const result = await client.sessionsList({
        limit: limit ?? undefined,
        includeLastMessage: true,
        includeDerivedTitles: true,
      });
      const sessions = result.sessions.map((s) => ({
        key: s.key,
        sessionId: s.sessionId,
        displayName: s.displayName,
        model: s.model,
        modelProvider: s.modelProvider,
        updatedAt: s.updatedAt,
        label: s.label,
        derivedTitle: s.derivedTitle,
        lastMessagePreview: s.lastMessagePreview,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: result.count, sessions }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// --- Tool: openclaw_chat_send ---
server.tool(
  "openclaw_chat_send",
  "Send a message to an OpenClaw session and wait for the full agent response. Blocks until the agent finishes replying.",
  {
    sessionKey: z.string().min(1).describe("Session key to send the message to (e.g. 'main')"),
    message: z.string().min(1).describe("The message text to send"),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(600_000)
      .optional()
      .describe("Timeout in milliseconds (default: 120000)"),
  },
  async ({ sessionKey, message, timeoutMs }) => {
    try {
      const result = await client.chatSend(sessionKey, message, timeoutMs ?? 120_000);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { runId: result.runId, state: result.state, response: result.response },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// --- Tool: openclaw_chat_history ---
server.tool(
  "openclaw_chat_history",
  "Get recent chat history for an OpenClaw session.",
  {
    sessionKey: z.string().min(1).describe("Session key (e.g. 'main')"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe("Max number of messages to return (default: 50)"),
  },
  async ({ sessionKey, limit }) => {
    try {
      const result = await client.chatHistory(sessionKey, limit ?? 50);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`OpenClaw MCP server started (gateway: ${OPENCLAW_URL})\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
