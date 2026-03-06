// agent.getProfile RPC handler.
// Returns agent identity (name, emoji), model config, and the agent workspace's
// memory/profile markdown files (AGENTS/MEMORY/USER/IDENTITY/SOUL.md) for a given
// agentId or sessionKey. Used by Anthroid to initialize the local workspace and
// sync memory from gateway agents. Re-ported onto upstream's per-handler-module
// structure (sibling of agent-identity.ts) during the 0724 upstream rebase.
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAgentGetProfileParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { resolveAgentIdFromSessionKey } from "../../config/sessions.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { resolveAssistantIdentity } from "../assistant-identity.js";
import {
  resolveAgentConfig,
  resolveAgentWorkspaceDir,
} from "../../agents/agent-scope.js";
import type { GatewayRequestHandlers } from "./types.js";

export const agentGetProfileHandler: GatewayRequestHandlers["agent.getProfile"] = async ({
  params,
  respond,
  context,
}) => {
  if (!validateAgentGetProfileParams(params)) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `invalid agent.getProfile params: ${formatValidationErrors(
          validateAgentGetProfileParams.errors,
        )}`,
      ),
    );
    return;
  }
  const agentIdRaw = normalizeOptionalString(params.agentId) ?? "";
  const sessionKeyRaw = normalizeOptionalString(params.sessionKey) ?? "";
  let agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : undefined;
  if (sessionKeyRaw) {
    const resolved = resolveAgentIdFromSessionKey(sessionKeyRaw);
    agentId = resolved;
  }
  const cfg = context.getRuntimeConfig();
  const identity = resolveAssistantIdentity({ cfg, agentId });
  const resolvedAgentId = identity.agentId;
  const agentConfig = resolveAgentConfig(cfg, resolvedAgentId);

  const workspaceDir = resolveAgentWorkspaceDir(cfg, resolvedAgentId);
  const readFile = async (name: string): Promise<string | null> => {
    try {
      const content = await fs.readFile(path.join(workspaceDir, name), "utf-8");
      return content.trim() ? content : null;
    } catch {
      return null;
    }
  };

  const [agentsContent, memoryContent, userContent, identityContent, soulContent] =
    await Promise.all([
      readFile("AGENTS.md"),
      readFile("MEMORY.md"),
      readFile("USER.md"),
      readFile("IDENTITY.md"),
      readFile("SOUL.md"),
    ]);

  respond(
    true,
    {
      agentId: resolvedAgentId,
      name: identity.name,
      emoji: identity.emoji,
      model: agentConfig?.model,
      agentsContent,
      memoryContent,
      userContent,
      identityContent,
      soulContent,
    },
    undefined,
  );
};
