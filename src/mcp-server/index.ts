#!/usr/bin/env node
// openclaw MCP server — thin wrapper around the built-in channel-server
// Exposes tools: conversations_list, messages_read, messages_send,
//               events_poll, events_wait, conversation_get, attachments_fetch,
//               permissions_list_open, permissions_respond
//
// Run via: node dist/mcp-server.js
// Or via:  node dist/entry.js mcp serve  (preferred — uses device identity for auth)
//
// Environment:
//   OPENCLAW_URL   — override gateway WebSocket URL
//   OPENCLAW_TOKEN — override gateway token

import { serveOpenClawChannelMcp } from "../mcp/channel-server.js";

await serveOpenClawChannelMcp({
  gatewayUrl: process.env["OPENCLAW_URL"],
  gatewayToken: process.env["OPENCLAW_TOKEN"] || undefined,
  claudeChannelMode: "auto",
  verbose: process.env["OPENCLAW_MCP_VERBOSE"] === "1",
});
