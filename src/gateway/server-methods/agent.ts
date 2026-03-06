import { agentGetProfileHandler } from "./agent-get-profile.js";
import { agentApplyMemoryPatchHandler, agentGetMemoryPatchHandler } from "./agent-memory-patch.js";
import { agentRunHandler } from "./agent-run-handler.js";
import { agentWaitHandler } from "./agent-wait.js";
// Gateway agent methods implement agent.run, agent.wait, agent profile, and
// agent memory-patch (Anthroid memory sync) RPCs.
import type { GatewayRequestHandlers } from "./types.js";

export const agentHandlers: GatewayRequestHandlers = {
  agent: agentRunHandler,
  "agent.getProfile": agentGetProfileHandler,
  "agent.getMemoryPatch": agentGetMemoryPatchHandler,
  "agent.applyMemoryPatch": agentApplyMemoryPatchHandler,
  "agent.wait": agentWaitHandler,
};
